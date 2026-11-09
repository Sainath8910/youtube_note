from django.urls import path

from .views import (
    PeerAcknowledgeView,
    PeerApplyView,
    PeerChangesView,
    PeerReconcileView,
    PeerSnapshotView,
)

urlpatterns = [
    path("peer/snapshot/", PeerSnapshotView.as_view(), name="sync-peer-snapshot"),
    path("peer/changes/", PeerChangesView.as_view(), name="sync-peer-changes"),
    path("peer/apply/", PeerApplyView.as_view(), name="sync-peer-apply"),
    path("peer/reconcile/", PeerReconcileView.as_view(), name="sync-peer-reconcile"),
    path("peer/acknowledge/", PeerAcknowledgeView.as_view(), name="sync-peer-acknowledge"),
]
