from django.urls import path

from .views import (
    NoteDetailView,
    NoteListCreateView,
    TrashListView,
    TrashPermanentDeleteView,
    TrashRestoreView,
    VideoNoteCreateView,
)


urlpatterns = [
    path(
        "",
        NoteListCreateView.as_view(),
        name="note-list-create",
    ),
    path(
        "video/",
        VideoNoteCreateView.as_view(),
        name="video-note-create",
    ),
    path("trash/", TrashListView.as_view(), name="trash-list"),
    path(
        "trash/<str:entity>/<int:pk>/restore/",
        TrashRestoreView.as_view(),
        name="trash-restore",
    ),
    path(
        "trash/<str:entity>/<int:pk>/permanent/",
        TrashPermanentDeleteView.as_view(),
        name="trash-permanent-delete",
    ),
    path(
        "<int:pk>/",
        NoteDetailView.as_view(),
        name="note-detail",
    ),
]