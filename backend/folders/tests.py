from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from folders.models import Folder
from notes.models import Note


class FolderTrashTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="folder-trash-user",
            password="test-password",
        )
        self.client.force_authenticate(self.user)

    def test_deleting_folder_tree_keeps_notes_live_and_restorable(self):
        parent = Folder.objects.create(user=self.user, name="Parent")
        child = Folder.objects.create(
            user=self.user,
            name="Child",
            parent=parent,
        )
        parent_note = Note.objects.create(
            user=self.user,
            folder=parent,
            title="Parent note",
            note_type=Note.NoteType.STANDALONE,
        )
        child_note = Note.objects.create(
            user=self.user,
            folder=child,
            title="Child note",
            note_type=Note.NoteType.STANDALONE,
        )

        response = self.client.delete(f"/api/folders/{parent.pk}/")
        self.assertEqual(response.status_code, 204)

        parent.refresh_from_db()
        child.refresh_from_db()
        parent_note.refresh_from_db()
        child_note.refresh_from_db()
        self.assertIsNotNone(parent.deleted_at)
        self.assertIsNotNone(child.deleted_at)
        self.assertIsNone(parent_note.deleted_at)
        self.assertIsNone(child_note.deleted_at)
        self.assertEqual(
            {item["id"] for item in self.client.get("/api/notes/").data},
            {parent_note.pk, child_note.pk},
        )
        self.assertEqual(
            self.client.get(f"/api/notes/{parent_note.pk}/").status_code,
            200,
        )
        self.assertEqual(
            self.client.get(f"/api/notes/{child_note.pk}/").status_code,
            200,
        )
        trash = self.client.get("/api/notes/trash/").data["items"]
        self.assertEqual(
            [(item["entity"], item["id"]) for item in trash],
            [("folder", parent.pk)],
        )

        restored = self.client.post(
            f"/api/notes/trash/folder/{parent.pk}/restore/",
            {},
            format="json",
        )
        self.assertEqual(restored.status_code, 200, restored.data)
        parent.refresh_from_db()
        child.refresh_from_db()
        parent_note.refresh_from_db()
        child_note.refresh_from_db()
        self.assertIsNone(parent.deleted_at)
        self.assertIsNone(child.deleted_at)
        self.assertIsNone(parent_note.deleted_at)
        self.assertIsNone(child_note.deleted_at)
