from django.urls import path

from apps.inbox import views

app_name = "inbox"

urlpatterns = [
    path("", views.InboxListView.as_view(), name="inbox-list"),
    path("sync/", views.InboxSyncView.as_view(), name="inbox-sync"),
    path("<str:email_id>/", views.InboxDetailView.as_view(), name="inbox-detail"),
    path(
        "<str:email_id>/ingest/",
        views.InboxIngestView.as_view(),
        name="inbox-ingest",
    ),
    path(
        "<str:email_id>/dismiss/",
        views.InboxDismissView.as_view(),
        name="inbox-dismiss",
    ),
]
