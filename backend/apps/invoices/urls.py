from django.urls import path

from apps.invoices import views

app_name = "invoices"

urlpatterns = [
    # Reference data (contract §3)
    path("departments/", views.DepartmentListView.as_view(), name="departments"),
    path("gl-accounts/", views.GLAccountListView.as_view(), name="gl-accounts"),
    path("tax-codes/", views.TaxCodeListView.as_view(), name="tax-codes"),
    # Invoices (contract §4, §5)
    path("invoices/", views.InvoiceListView.as_view(), name="invoice-list"),
    path("invoices/upload/", views.InvoiceUploadView.as_view(), name="invoice-upload"),
    path(
        "invoices/<str:invoice_id>/",
        views.InvoiceDetailView.as_view(),
        name="invoice-detail",
    ),
    path(
        "invoices/<str:invoice_id>/analyze/",
        views.InvoiceAnalyzeView.as_view(),
        name="invoice-analyze",
    ),
    path(
        "invoices/<str:invoice_id>/resolve-finding/",
        views.InvoiceResolveFindingView.as_view(),
        name="invoice-resolve-finding",
    ),
    path(
        "invoices/<str:invoice_id>/submit/",
        views.InvoiceSubmitView.as_view(),
        name="invoice-submit",
    ),
]
