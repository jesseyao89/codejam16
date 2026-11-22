from django.urls import path

from apps.approvals import views

app_name = "approvals"

urlpatterns = [
    path("", views.ApprovalListView.as_view(), name="approval-list"),
    path(
        "<str:approval_id>/",
        views.ApprovalDetailView.as_view(),
        name="approval-detail",
    ),
    path(
        "<str:approval_id>/approve/",
        views.ApprovalApproveView.as_view(),
        name="approval-approve",
    ),
    path(
        "<str:approval_id>/reject/",
        views.ApprovalRejectView.as_view(),
        name="approval-reject",
    ),
]
