from uuid import UUID
from datetime import timedelta

from django.core import signing
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from folders.models import Folder
from notes.models import Note

from .authentication import BridgePeerAndUserAuthentication
from .models import BootstrapSnapshot, ChangeEvent, IdentityMapping, RecordState
from .services import apply_change, installation_uuid, snapshot_rows


class PeerView(APIView):
    authentication_classes = [BridgePeerAndUserAuthentication]
    permission_classes = [IsAuthenticated]

    @property
    def peer_id(self):
        return self.request.auth.installation_id


class PeerSnapshotView(PeerView):
    @transaction.atomic
    def get(self, request):
        try:
            offset = max(0, int(request.query_params.get("offset", "0")))
            limit = min(100, max(1, int(request.query_params.get("limit", "50"))))
        except ValueError:
            return Response({"detail": "Invalid page."}, status=400)
        snapshot_id = request.query_params.get("snapshot_id")
        if snapshot_id:
            try:
                snapshot_uuid = UUID(snapshot_id)
            except ValueError:
                return Response({"detail": "Invalid snapshot identifier."}, status=400)
            snapshot = BootstrapSnapshot.objects.filter(
                owner=request.user,
                peer_installation=self.peer_id,
                snapshot_id=snapshot_uuid,
            ).first()
            if snapshot is None or snapshot.created_at < timezone.now() - timedelta(days=1):
                return Response({"code": "snapshot_expired"}, status=410)
        else:
            BootstrapSnapshot.objects.filter(
                created_at__lt=timezone.now() - timedelta(days=1)
            ).delete()
            rows = snapshot_rows(request.user)
            if len(rows) > 2000:
                return Response(
                    {"detail": "The inventory exceeds the safe snapshot limit."},
                    status=413,
                )
            high_watermark = ChangeEvent.objects.filter(owner=request.user).order_by(
                "-pk"
            ).values_list("pk", flat=True).first() or 0
            snapshot = BootstrapSnapshot.objects.create(
                owner=request.user, peer_installation=self.peer_id,
                records=rows, high_watermark=high_watermark,
            )
        page = snapshot.records[offset:offset + limit]
        return Response({
            "installation_id": str(installation_uuid()),
            "snapshot_id": str(snapshot.snapshot_id),
            "high_watermark": snapshot.high_watermark,
            "records": page,
            "next_offset": offset + len(page) if offset + len(page) < len(snapshot.records) else None,
        })


class PeerChangesView(PeerView):
    def get(self, request):
        last_id = 0
        cursor = request.query_params.get("cursor")
        if cursor:
            try:
                decoded = signing.loads(
                    cursor, salt="notes-sync-cursor", max_age=60 * 60 * 24 * 90
                )
                if decoded["owner"] != request.user.pk or decoded["peer"] != str(self.peer_id):
                    raise signing.BadSignature
                last_id = int(decoded["last"])
            except (signing.BadSignature, KeyError, TypeError, ValueError):
                return Response({"code": "cursor_expired"}, status=410)
        try:
            limit = min(100, max(1, int(request.query_params.get("limit", "50"))))
        except ValueError:
            return Response({"detail": "Invalid limit."}, status=400)
        rows = list(ChangeEvent.objects.filter(
            owner=request.user, pk__gt=last_id
        ).order_by("pk")[:limit + 1])
        more = len(rows) > limit
        rows = rows[:limit]
        next_id = rows[-1].pk if rows else last_id
        return Response({
            "installation_id": str(installation_uuid()),
            "events": [{
                "sequence": event.pk,
                "entity": event.entity,
                "record_uuid": str(event.record_uuid),
                "revision": event.revision,
                "operation_id": str(event.operation_id),
                "origin_installation": str(event.origin_installation) if event.origin_installation else None,
                "origin_operation": str(event.origin_operation) if event.origin_operation else None,
                "snapshot": event.snapshot,
                "deleted": event.deleted,
            } for event in rows if event.origin_installation != self.peer_id],
            "next_cursor": signing.dumps(
                {"owner": request.user.pk, "peer": str(self.peer_id), "last": next_id},
                salt="notes-sync-cursor",
            ),
            "has_more": more,
        })


class PeerApplyView(PeerView):
    def post(self, request):
        changes = request.data.get("changes")
        if not isinstance(changes, list) or not 1 <= len(changes) <= 50:
            return Response({"detail": "changes must contain 1 to 50 items."}, status=400)
        results = [
            apply_change(request.user, item, self.peer_id)
            if isinstance(item, dict)
            else {"status": "invalid", "reason": "invalid_change"}
            for item in changes
        ]
        return Response({"results": results})


class PeerReconcileView(PeerView):
    def post(self, request):
        try:
            entity = request.data["entity"]
            local_uuid = UUID(request.data["local_uuid"])
            peer_uuid = UUID(request.data["peer_uuid"])
            mapping_id = UUID(request.data["mapping_id"])
            action = request.data["action"]
        except (KeyError, ValueError, TypeError):
            return Response({"detail": "Invalid mapping request."}, status=400)
        if entity not in {"note", "folder"} or action not in {"pair", "separate", "defer"}:
            return Response({"detail": "Unsupported mapping action."}, status=400)
        if action == "pair":
            exists = (
                Note.objects.filter(user=request.user, sync_uuid=local_uuid).exists()
                if entity == "note"
                else Folder.objects.filter(user=request.user, sync_uuid=local_uuid).exists()
            )
            if not exists:
                return Response({"detail": "Record not found."}, status=404)
        desired_status = {
            "pair": IdentityMapping.Status.CONFIRMED,
            "defer": IdentityMapping.Status.DEFERRED,
            "separate": IdentityMapping.Status.REVOKED,
        }[action]
        active_statuses = (
            IdentityMapping.Status.PENDING,
            IdentityMapping.Status.CONFIRMED,
            IdentityMapping.Status.DEFERRED,
        )
        try:
            with transaction.atomic():
                mapping = IdentityMapping.objects.filter(
                    owner=request.user, entity=entity,
                    peer_installation=self.peer_id, local_uuid=local_uuid,
                    status__in=active_statuses,
                ).select_for_update().first()
                if mapping and mapping.peer_uuid != peer_uuid:
                    return Response({"code": "mapping_conflict"}, status=409)
                if mapping is None and action == "separate":
                    mapping = IdentityMapping.objects.filter(
                        owner=request.user, entity=entity,
                        peer_installation=self.peer_id, local_uuid=local_uuid,
                        peer_uuid=peer_uuid, status=IdentityMapping.Status.REVOKED,
                    ).order_by("-updated_at").first()
                if mapping is None:
                    mapping = IdentityMapping.objects.create(
                        owner=request.user, entity=entity,
                        peer_installation=self.peer_id, local_uuid=local_uuid,
                        peer_uuid=peer_uuid, mapping_id=mapping_id,
                        status=desired_status,
                        audit=[{
                            "action": action, "state": "confirmed",
                            "actor": str(request.user.supabase_uid),
                            "ai_uuid": str(peer_uuid), "non_ai_uuid": str(local_uuid),
                        }],
                    )
                elif mapping.mapping_id != mapping_id:
                    return Response({"code": "mapping_conflict"}, status=409)
        except IntegrityError:
            return Response({"code": "mapping_conflict"}, status=409)
        if mapping.status != desired_status:
            mapping.status = desired_status
            mapping.audit = mapping.audit + [{
                "action": action, "state": "confirmed",
                "actor": str(request.user.supabase_uid),
                "ai_uuid": str(peer_uuid), "non_ai_uuid": str(local_uuid),
            }]
            mapping.save(update_fields=["status", "audit", "updated_at"])
        return Response({"mapping_id": str(mapping.mapping_id), "status": mapping.status})


class PeerAcknowledgeView(PeerView):
    def post(self, request):
        try:
            entity = request.data["entity"]
            record_uuid = UUID(request.data["record_uuid"])
            revision = int(request.data["revision"])
        except (KeyError, ValueError, TypeError):
            return Response({"detail": "Invalid acknowledgment."}, status=400)
        if entity not in {"note", "folder"} or revision < 0:
            return Response({"detail": "Invalid acknowledgment."}, status=400)
        state = RecordState.objects.filter(
            owner=request.user, entity=entity, record_uuid=record_uuid
        ).first()
        if state is None:
            return Response({"detail": "Record not found."}, status=404)
        state.peer_revision = max(state.peer_revision or 0, revision)
        state.save(update_fields=["peer_revision", "updated_at"])
        return Response({"status": "acknowledged"})
