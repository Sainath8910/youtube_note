import uuid
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from folders.models import Folder
from playlists.models import Playlist

from .models import Note


TRASH_RETENTION = timedelta(days=30)


class TrashRestoreConflict(Exception):
    pass


def _folder_subtree(user, root):
    children_by_parent = {}
    folders = list(Folder.objects.filter(user=user).select_related("parent"))
    for folder in folders:
        children_by_parent.setdefault(folder.parent_id, []).append(folder)

    collected = []
    pending = [root]
    visited = set()
    while pending:
        folder = pending.pop()
        if folder.pk in visited:
            continue
        visited.add(folder.pk)
        if folder.deleted_at is None:
            collected.append(folder)
        pending.extend(children_by_parent.get(folder.pk, []))
    return collected


@transaction.atomic
def trash_note(note, now=None, batch_id=None):
    if note.deleted_at is not None:
        return note
    note.deleted_at = now or timezone.now()
    note.trash_batch_id = batch_id or uuid.uuid4()
    note.save(update_fields=("deleted_at", "trash_batch_id", "updated_at"))
    return note


@transaction.atomic
def trash_folder(folder, now=None):
    deleted_at = now or timezone.now()
    batch_id = uuid.uuid4()
    folders = _folder_subtree(folder.user, folder)

    for item in folders:
        item.deleted_at = deleted_at
        item.trash_batch_id = batch_id
        item.save(update_fields=("deleted_at", "trash_batch_id", "updated_at"))
    return folder


def _check_restore_folder_names(user, folders, batch_id):
    grouped_ids = {folder.pk for folder in folders}
    for folder in folders:
        if folder.parent_id and folder.parent_id not in grouped_ids:
            parent = Folder.objects.filter(
                pk=folder.parent_id, user=user, deleted_at__isnull=True
            ).exists()
            if not parent:
                raise TrashRestoreConflict(
                    "Restore the trashed parent folder first."
                )
        duplicates = Folder.objects.filter(
            user=user,
            parent_id=folder.parent_id,
            name=folder.name,
            deleted_at__isnull=True,
        ).exclude(pk__in=grouped_ids)
        if duplicates.exists():
            raise TrashRestoreConflict(
                f'A live folder named "{folder.name}" already exists in this location.'
            )


@transaction.atomic
def restore_trash(user, entity, pk, now=None):
    now = now or timezone.now()
    if entity == "note":
        item = Note.objects.filter(
            user=user, pk=pk, deleted_at__isnull=False
        ).first()
        model = Note
    elif entity == "folder":
        item = Folder.objects.filter(
            user=user, pk=pk, deleted_at__isnull=False
        ).first()
        model = Folder
    elif entity == "playlist":
        item = Playlist.objects.filter(
            user=user, pk=pk, deleted_at__isnull=False
        ).first()
        model = Playlist
    else:
        raise ValueError("Unsupported trash entity.")
    if item is None:
        return None
    if item.deleted_at <= now - TRASH_RETENTION:
        return None

    batch_id = item.trash_batch_id
    if batch_id is None:
        items = [item]
    else:
        items = list(model.objects.filter(
            user=user, trash_batch_id=batch_id, deleted_at__isnull=False
        ).order_by("pk"))
    folders = items if entity == "folder" else []
    if folders:
        _check_restore_folder_names(user, folders, batch_id)

    for row in items:
        row.deleted_at = None
        row.trash_batch_id = None
        row.save(update_fields=("deleted_at", "trash_batch_id", "updated_at"))
    return item


@transaction.atomic
def permanently_delete_trash(user, entity, pk):
    models_by_entity = {
        "note": Note,
        "folder": Folder,
        "playlist": Playlist,
    }
    model = models_by_entity.get(entity)
    if model is None:
        raise ValueError("Unsupported trash entity.")

    item = model.objects.filter(
        user=user, pk=pk, deleted_at__isnull=False
    ).first()
    if item is None:
        return None

    if entity == "folder":
        folders = list(Folder.objects.filter(
            user=user,
            trash_batch_id=item.trash_batch_id,
            deleted_at__isnull=False,
        )) if item.trash_batch_id else [item]
        folder_ids = {folder.pk for folder in folders}
        folder_by_id = {folder.pk: folder for folder in folders}
        depths = {}

        def depth(folder, visited=None):
            if folder.pk in depths:
                return depths[folder.pk]
            visited = visited or set()
            if folder.pk in visited or folder.parent_id not in folder_ids:
                return 0
            visited.add(folder.pk)
            parent = folder_by_id.get(folder.parent_id)
            value = 1 + depth(parent, visited) if parent else 0
            depths[folder.pk] = value
            return value

        items = sorted(folders, key=depth, reverse=True)

        for child in Folder.objects.filter(
            user=user, parent_id__in=folder_ids
        ).exclude(pk__in=folder_ids):
            child.parent = None
            child.save(update_fields=("parent",))
    else:
        items = [item]

    from sync_bridge.services import portable_snapshot, write_change

    for row in items:
        if entity == "folder":
            notes = Note.objects.filter(
                user_id=row.user_id, folder_id=row.pk
            ).select_related("user", "folder", "video")
            for note in notes:
                snapshot = portable_snapshot(note)
                snapshot["folder_sync_uuid"] = None
                write_change(
                    note.user,
                    "note",
                    note.sync_uuid,
                    snapshot,
                    deleted=note.deleted_at is not None,
                )

        write_change(
            row.user,
            entity,
            row.sync_uuid,
            {"deleted_at": row.deleted_at.isoformat()},
            deleted=True,
        )
        row.delete()

    return item


def list_trash(user, now=None):
    now = now or timezone.now()
    cutoff = now - TRASH_RETENTION
    notes = Note.objects.filter(
        user=user, deleted_at__gt=cutoff
    ).exclude(
        folder__deleted_at__gt=cutoff,
        folder__trash_batch_id=F("trash_batch_id"),
    ).select_related("folder", "video").order_by("-deleted_at", "-pk")
    folders = Folder.objects.filter(
        user=user, deleted_at__gt=cutoff
    ).exclude(
        parent__deleted_at__gt=cutoff,
        parent__trash_batch_id=F("trash_batch_id"),
    ).order_by("-deleted_at", "-pk")
    playlists = Playlist.objects.filter(
        user=user, deleted_at__gt=cutoff
    ).order_by("-deleted_at", "-pk")

    entries = [
        {
            "entity": "note",
            "id": note.pk,
            "sync_uuid": str(note.sync_uuid),
            "title": note.title,
            "note_type": note.note_type,
            "video_title": note.video.title if note.video_id else "",
            "deleted_at": note.deleted_at.isoformat(),
            "expires_at": (note.deleted_at + TRASH_RETENTION).isoformat(),
        }
        for note in notes
    ]
    entries.extend({
        "entity": "folder",
        "id": folder.pk,
        "sync_uuid": str(folder.sync_uuid),
        "title": folder.name,
        "deleted_at": folder.deleted_at.isoformat(),
        "expires_at": (folder.deleted_at + TRASH_RETENTION).isoformat(),
    } for folder in folders)
    entries.extend({
        "entity": "playlist",
        "id": playlist.pk,
        "sync_uuid": str(playlist.sync_uuid),
        "title": playlist.title,
        "deleted_at": playlist.deleted_at.isoformat(),
        "expires_at": (playlist.deleted_at + TRASH_RETENTION).isoformat(),
    } for playlist in playlists)
    return sorted(entries, key=lambda entry: entry["deleted_at"], reverse=True)


def expired_trash(now=None):
    cutoff = (now or timezone.now()) - TRASH_RETENTION
    return (
        Note.objects.filter(deleted_at__lte=cutoff),
        Folder.objects.filter(deleted_at__lte=cutoff),
        Playlist.objects.filter(deleted_at__lte=cutoff),
    )
