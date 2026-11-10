import logging

from django.db import transaction
from rest_framework import generics, status
from rest_framework.exceptions import APIException, NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from videos.models import Video
from videos.serializers import VideoSerializer
from videos.services.youtube import (
    InvalidYouTubeVideoIdError,
    YouTubeMetadataError,
    fetch_youtube_metadata,
)
from playlists.services import add_video_to_youtube_playlist

from .models import Note
from .serializers import NoteSerializer
from .trash import TrashRestoreConflict, list_trash, restore_trash, trash_note

logger = logging.getLogger(__name__)


class NoteListCreateView(generics.ListCreateAPIView):
    serializer_class = NoteSerializer

    def get_queryset(self):
        return Note.objects.filter(
            user=self.request.user,
            deleted_at__isnull=True,
        ).select_related(
            "video",
            "folder",
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class NoteDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = NoteSerializer

    def get_queryset(self):
        return Note.objects.filter(
            user=self.request.user,
            deleted_at__isnull=True,
        ).select_related(
            "video",
            "folder",
        )

    def perform_update(self, serializer):
        serializer.save()

    def perform_destroy(self, instance):
        trash_note(instance)


class TrashListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"items": list_trash(request.user)})


class TrashRestoreView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, entity, pk):
        try:
            item = restore_trash(request.user, entity, pk)
        except TrashRestoreConflict as error:
            return Response({"detail": str(error)}, status=status.HTTP_409_CONFLICT)
        if item is None:
            raise NotFound("This trash item is missing or its 30-day recovery period has expired.")
        return Response({"status": "restored"})

class VideoNoteCreateView(generics.CreateAPIView):
    serializer_class = NoteSerializer

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        data = request.data.copy()
        playlist_id = data.pop("youtube_playlist_id", None)
        playlist_title = data.pop("youtube_playlist_title", "")
        playlist_thumbnail = data.pop("youtube_playlist_thumbnail_url", "")
        playlist_channel = data.pop("youtube_playlist_channel_name", "")
        playlist_videos = data.pop("youtube_playlist_videos", [])
        playlist_position = data.pop("youtube_playlist_current_position", None)

        youtube_id = data.get("youtube_id")

        if not youtube_id:
            return Response(
                {"error": "youtube_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            video_metadata = fetch_youtube_metadata(youtube_id)
            metadata_resolved = True
        except InvalidYouTubeVideoIdError:
            return Response(
                {"error": "youtube_id must be a valid YouTube video ID."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except YouTubeMetadataError:
            logger.warning(
                "YouTube metadata unavailable for youtube_id=%s; continuing with fallback metadata.",
                youtube_id,
            )
            video_metadata = {
                "title": "",
                "channel_name": "",
                "channel_handle": "",
                "channel_id": "",
                "thumbnail_url": (
                    f"https://i.ytimg.com/vi/{youtube_id}/hqdefault.jpg"
                ),
                "duration_seconds": None,
            }
            metadata_resolved = False

        video, created = Video.objects.get_or_create(
            youtube_id=youtube_id,
            defaults=video_metadata,
        )

        updated_fields = []

        for field, value in video_metadata.items():
            if value is None or value == "":
                continue

            current_value = getattr(video, field)
            should_update = (
                metadata_resolved and current_value != value
            ) or (not metadata_resolved and not current_value)
            if should_update:
                setattr(video, field, value)
                updated_fields.append(field)

        if updated_fields:
            updated_fields.append("updated_at")
            video.save(update_fields=updated_fields)

        data.pop("youtube_id", None)
        data["video"] = video.id

        serializer = self.get_serializer(
            data=data,
            context=self.get_serializer_context(),
        )

        serializer.is_valid(raise_exception=True)
        note = serializer.save(user=request.user)
        if playlist_id:
            add_video_to_youtube_playlist(
                user=request.user,
                video=video,
                playlist_id=playlist_id,
                title=playlist_title,
                thumbnail_url=playlist_thumbnail,
                channel_name=playlist_channel,
                playlist_videos=playlist_videos if isinstance(playlist_videos, list) else [],
                current_position=playlist_position,
            )
        return Response(
            {
                "video_created": created,
                "metadata_resolved": metadata_resolved,
                "video": VideoSerializer(video).data,
                "note": NoteSerializer(note).data,
            },
            status=status.HTTP_201_CREATED,
        )
