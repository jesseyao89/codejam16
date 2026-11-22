from django.urls import path

from apps.audit import views

app_name = "audit"

urlpatterns = [
    path("", views.AuditEventListView.as_view(), name="audit-list"),
    path("export/", views.AuditExportView.as_view(), name="audit-export"),
]
