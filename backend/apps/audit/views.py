"""Audit trail endpoints (contract §9)."""

import csv
import json
from datetime import timezone

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import role_required
from apps.audit import services
from apps.audit.models import AuditEvent
from apps.audit.serializers import AuditEventSerializer
from apps.invoices.actions import visible_invoices

_AUDIT_ROLES = {"CONTROLLER", "AUDITOR"}

_CSV_COLUMNS = [
    "id",
    "timestamp",
    "actor_id",
    "actor_name",
    "on_behalf_of_id",
    "action",
    "entity_type",
    "entity_id",
    "before",
    "after",
    "evidence",
]


class AuditEventListView(generics.ListAPIView):
    serializer_class = AuditEventSerializer
    permission_classes = [role_required(*_AUDIT_ROLES, allow_on_leave=True)]

    def get_queryset(self):
        queryset = AuditEvent.objects.select_related("actor")
        queryset = services.filter_events(queryset, self.request.query_params)
        return queryset.order_by("-timestamp")


class AuditExportView(APIView):
    permission_classes = [role_required(*_AUDIT_ROLES, allow_on_leave=True)]

    def get(self, request):
        queryset = AuditEvent.objects.select_related("actor")
        queryset = services.filter_events(
            queryset, request.query_params
        ).order_by("-timestamp")

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="audit_events.csv"'
        writer = csv.writer(response)
        writer.writerow(_CSV_COLUMNS)

        for event in queryset:
            writer.writerow(
                [
                    f"AUD-{event.pk:05d}",
                    event.timestamp.astimezone(timezone.utc).strftime(
                        "%Y-%m-%dT%H:%M:%SZ"
                    ),
                    event.actor.user_id if event.actor else "",
                    event.actor.get_full_name() if event.actor else "",
                    (event.evidence or {}).get("on_behalf_of") or "",
                    event.action,
                    event.entity_type,
                    event.entity_id,
                    json.dumps(event.before or {}),
                    json.dumps(event.after or {}),
                    json.dumps(event.evidence or {}),
                ]
            )
        return response


class InvoiceTraceView(APIView):
    permission_classes = [role_required(*_AUDIT_ROLES, allow_on_leave=True)]

    def get(self, request, invoice_id):
        invoice = get_object_or_404(
            visible_invoices(request.user), invoice_id=invoice_id
        )
        return Response(services.invoice_trace(invoice))
