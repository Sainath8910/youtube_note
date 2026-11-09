import logging
import re

from django.db.models import Count, Max, Q
from django.db.models.functions import Coalesce, Greatest, Lower
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from notes.models import Note
from notes.serializers import NoteSerializer
from .models import Video
from .pagination import VideoLibraryPagination
from .services.transcript import (
    TranscriptRetrievalError,
    TranscriptUnavailableError,
    fetch_youtube_transcript,
)
from .serializers import VideoLibrarySerializer, VideoSerializer

logger = logging.getLogger(__name__)
_YOUTUBE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _videos_for_user(user):
    return (
        Video.objects.filter(
            Q(notes__user=user, notes__deleted_at__isnull=True)
            | Q(viewing_sessions__user=user)
        )
        .annotate(
            notes_count=Count(
                "notes",
                filter=Q(
                    notes__user=user,
                    notes__deleted_at__isnull=True,
                    notes__note_type=Note.NoteType.VIDEO,
                ),
                distinct=True,
            ),
            library_updated_at=Coalesce(
                Greatest(
                    "updated_at",
                    Max(
                        "notes__updated_at",
                        filter=Q(
                            notes__user=user,
                            notes__deleted_at__isnull=True,
                        ),
                    ),
                ),
                "updated_at",
            ),
        )
        .distinct()
    )


class VideoContextView(APIView):
    def get(self, request, youtube_id):
        if not _YOUTUBE_ID_PATTERN.fullmatch(youtube_id):
            return Response(
                {"error": "Invalid YouTube video ID."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            video = Video.objects.get(youtube_id=youtube_id)
        except Video.DoesNotExist:
            return Response(
                {"saved": False, "video": None, "notes": []},
                status=status.HTTP_200_OK,
            )

        notes = Note.objects.filter(
            user=request.user,
            video=video,
            deleted_at__isnull=True,
        ).select_related("folder")

        return Response(
            {
                "saved": True,
                "video": VideoSerializer(video).data,
                "notes": NoteSerializer(
                    notes,
                    many=True,
                    context={"request": request},
                ).data,
            }
        )


class VideoLibraryView(APIView):
    pagination_class = VideoLibraryPagination
    availability_filters = {"all", "available", "missing", "processing", "failed"}
    sort_orders = {"updated", "added", "title", "notes"}

    def get(self, request):
        videos = _videos_for_user(request.user)
        query = request.query_params.get("q", "").strip()
        if query:
            videos = videos.filter(
                Q(title__icontains=query)
                | Q(channel_name__icontains=query)
            )

        transcript_filter = request.query_params.get("transcript", "all")
        if transcript_filter not in self.availability_filters:
            raise ValidationError(
                {"transcript": "Choose a valid transcript availability filter."},
            )

        if transcript_filter != "all":
            videos = self._filter_transcript_availability(
                videos,
                transcript_filter,
            )

        sort_order = request.query_params.get("sort", "updated")
        if sort_order not in self.sort_orders:
            raise ValidationError(
                {"sort": "Choose a valid video sort order."},
            )
        orderings = {
            "updated": ("-library_updated_at", "youtube_id"),
            "added": ("-created_at", "youtube_id"),
            "title": (Lower("title"), "youtube_id"),
            "notes": ("-notes_count", Lower("title"), "youtube_id"),
        }
        videos = videos.order_by(*orderings[sort_order])

        paginator = self.pagination_class()
        page = paginator.paginate_queryset(videos, request, view=self)
        serializer = VideoLibrarySerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

    @staticmethod
    def _filter_transcript_availability(videos, availability):
        usable_transcript = (
            Q(transcript_status=Video.TranscriptStatus.READY)
            & Q(transcript__isnull=False)
            & ~Q(transcript=[])
        )
        filters = {
            "available": usable_transcript,
            "processing": Q(
                transcript_status=Video.TranscriptStatus.FETCHING,
            ),
            "failed": Q(transcript_status=Video.TranscriptStatus.FAILED),
            "missing": (
                Q(transcript_status=Video.TranscriptStatus.NOT_STARTED)
                | (
                    Q(transcript_status=Video.TranscriptStatus.READY)
                    & ~usable_transcript
                )
            ),
        }
        return videos.filter(filters[availability])


class VideoDetailView(APIView):
    def get(self, request, youtube_id):
        if not _YOUTUBE_ID_PATTERN.fullmatch(youtube_id):
            return Response(
                {"error": "Invalid YouTube video ID."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        video = get_object_or_404(
            _videos_for_user(request.user),
            youtube_id=youtube_id,
        )
        notes = Note.objects.filter(
            user=request.user,
            video=video,
            note_type=Note.NoteType.VIDEO,
            deleted_at__isnull=True,
        ).select_related("folder", "video")
        return Response(
            {
                "video": VideoLibrarySerializer(video).data,
                "notes": NoteSerializer(
                    notes,
                    many=True,
                    context={"request": request},
                ).data,
            }
        )


class TranscriptView(APIView):
    def get(self, request, youtube_id):
        if not _YOUTUBE_ID_PATTERN.fullmatch(youtube_id):
            return Response(
                {"error": "Invalid YouTube video ID."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        video = get_object_or_404(
            _videos_for_user(request.user),
            youtube_id=youtube_id,
        )
        return self._response(video)

    def post(self, request, youtube_id):
        if not _YOUTUBE_ID_PATTERN.fullmatch(youtube_id):
            return Response(
                {"error": "Invalid YouTube video ID."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        video, _ = Video.objects.get_or_create(youtube_id=youtube_id)

        if video.transcript_status == Video.TranscriptStatus.READY:
            return self._response(video)

        video.transcript_status = Video.TranscriptStatus.FETCHING
        video.save(update_fields=["transcript_status", "updated_at"])

        try:
            transcript = fetch_youtube_transcript(youtube_id)
        except TranscriptUnavailableError as error:
            return self._failed_response(
                video,
                str(error),
                status.HTTP_404_NOT_FOUND,
            )
        except TranscriptRetrievalError as error:
            return self._failed_response(
                video,
                str(error),
                status.HTTP_502_BAD_GATEWAY,
            )
        except Exception:
            logger.exception(
                "Unexpected failure while fetching transcript for %s",
                youtube_id,
            )
            return self._failed_response(
                video,
                "Transcript retrieval failed.",
                status.HTTP_502_BAD_GATEWAY,
            )

        video.transcript = transcript["segments"]
        video.transcript_language = transcript["language"]
        video.transcript_fetched_at = timezone.now()
        video.transcript_status = Video.TranscriptStatus.READY
        video.save(
            update_fields=[
                "transcript",
                "transcript_language",
                "transcript_fetched_at",
                "transcript_status",
                "updated_at",
            ]
        )
        return self._response(video)

    @staticmethod
    def _response(video, response_status=status.HTTP_200_OK):
        return Response(
            {
                "youtube_id": video.youtube_id,
                "transcript_status": video.transcript_status,
                "transcript": (
                    {
                        "language": video.transcript_language,
                        "segments": video.transcript,
                    }
                    if video.transcript is not None
                    else None
                ),
                "transcript_fetched_at": video.transcript_fetched_at,
            },
            status=response_status,
        )

    @classmethod
    def _failed_response(cls, video, message, response_status):
        video.transcript_status = Video.TranscriptStatus.FAILED
        video.save(update_fields=["transcript_status", "updated_at"])
        return Response(
            {
                "youtube_id": video.youtube_id,
                "error": message,
                "transcript_status": video.transcript_status,
            },
            status=response_status,
        )
