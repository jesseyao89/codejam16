from django.urls import path

from apps.accounts import views

app_name = "delegations"

urlpatterns = [
    path("", views.DelegationListView.as_view(), name="delegation-list"),
    path(
        "<str:delegation_id>/",
        views.DelegationDetailView.as_view(),
        name="delegation-detail",
    ),
]
