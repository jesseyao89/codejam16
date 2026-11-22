from django.urls import path

from apps.vendors import views

app_name = "vendors"

urlpatterns = [
    path("", views.VendorListView.as_view(), name="vendor-list"),
    path(
        "<str:vendor_id>/bank-changes/",
        views.VendorBankChangeListView.as_view(),
        name="vendor-bank-changes",
    ),
    path("<str:vendor_id>/", views.VendorDetailView.as_view(), name="vendor-detail"),
]
