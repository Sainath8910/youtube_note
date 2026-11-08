import math

from rest_framework import serializers

from .models import Video


class VideoLibrarySerializer(serializers.ModelSerializer):
    youtube_url = serializers.SerializerMethodField()
    notes_count = serializers.IntegerField(read_only=True)
    updated_at = serializers.DateTimeField(
        source="library_updated_at",
        read_only=True,
    )
    transcript_availability = serializers.SerializerMethodField()

    class Meta:
        model = Video
        fields = [
            "id",
            "youtube_id",
            "title",
            "channel_name",
            "channel_handle",
            "channel_id",
            "thumbnail_url",
            "youtube_url",
            "notes_count",
            "transcript_availability",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_youtube_url(self, video):
        return f"https://www.youtube.com/watch?v={video.youtube_id}"

    def get_transcript_availability(self, video):
        statuses = {
            Video.TranscriptStatus.FETCHING: "processing",
            Video.TranscriptStatus.FAILED: "failed",
        }
        if video.transcript_status in statuses:
            return statuses[video.transcript_status]
        if (
            video.transcript_status == Video.TranscriptStatus.READY
            and isinstance(video.transcript, list)
            and video.transcript
            and all(
                isinstance(segment, dict)
                and isinstance(segment.get("text"), str)
                and isinstance(segment.get("start"), (int, float))
                and not isinstance(segment.get("start"), bool)
                and math.isfinite(segment["start"])
                and isinstance(segment.get("duration"), (int, float))
                and not isinstance(segment.get("duration"), bool)
                and math.isfinite(segment["duration"])
                for segment in video.transcript
            )
        ):
            return "available"
        return "missing"

class VideoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Video
        fields = [
            "id",
            "youtube_id",
            "title",
            "channel_name",
            "channel_handle",
            "channel_id",
            "thumbnail_url",
            "duration_seconds",
            "transcript_status",
            "transcript",
            "transcript_language",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
        ]
