from django.urls import path

from apps.invoices import views

app_name = "invoices"

urlpatterns = [
    path("departments/", views.DepartmentListView.as_view(), name="departments"),
    path("gl-accounts/", views.GLAccountListView.as_view(), name="gl-accounts"),
    path("tax-codes/", views.TaxCodeListView.as_view(), name="tax-codes"),
]
