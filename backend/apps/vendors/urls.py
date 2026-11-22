from django.urls import path

from apps.vendors import views

app_name = "vendors"

urlpatterns = [
    path("", views.VendorListView.as_view(), name="vendor-list"),
    path(
        "<str:vendor_id>/approve/",
        views.VendorApproveView.as_view(),
        name="vendor-approve",
    ),
    path("<str:vendor_id>/hold/", views.VendorHoldView.as_view(), name="vendor-hold"),
    path(
        "<str:vendor_id>/unhold/",
        views.VendorUnholdView.as_view(),
        name="vendor-unhold",
    ),
    path(
        "<str:vendor_id>/bank-changes/",
        views.VendorBankChangeListView.as_view(),
        name="vendor-bank-changes",
    ),
    path(
        "<str:vendor_id>/bank-changes/<str:change_id>/approve/",
        views.VendorBankChangeApproveView.as_view(),
        name="vendor-bank-change-approve",
    ),
    path(
        "<str:vendor_id>/bank-changes/<str:change_id>/reject/",
        views.VendorBankChangeRejectView.as_view(),
        name="vendor-bank-change-reject",
    ),
    path("<str:vendor_id>/", views.VendorDetailView.as_view(), name="vendor-detail"),
]
