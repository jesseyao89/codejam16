from django.urls import path

from apps.approvals import views

app_name = "policies"

urlpatterns = [
    path("", views.PolicyListView.as_view(), name="policy-list"),
    path(
        "<str:rule_id>/",
        views.PolicyDetailView.as_view(),
        name="policy-detail",
    ),
]
