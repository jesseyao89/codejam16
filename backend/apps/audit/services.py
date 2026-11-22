"""Audit read/composition helpers (contract §9)."""

from __future__ import annotations

from datetime import timezone

from django.db.models import Q
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.exceptions import ValidationError

from apps.audit.models import AuditEvent
from apps.audit.serializers import AuditEventSerializer


def record_audit(
    actor,
    action: str,
    entity_type: str,
    entity_id: str,
    before: dict | None = None,
    after: dict | None = None,
    evidence: dict | None = None,
) -> AuditEvent:
    """Append an audit event (call inside the transaction of the change)."""
    return AuditEvent.objects.create(
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=before or {},
        after=after or {},
        evidence=evidence or {},
    )


def _parse_day(value: str):
    parsed = parse_datetime(value)
    if parsed is not None:
        return parsed.date()
    day = parse_date(value)
    if day is not None:
        return day
    raise ValidationError("Invalid date; expected YYYY-MM-DD or ISO-8601.")


def filter_events(queryset, params):
    if params.get("entity_type"):
        queryset = queryset.filter(entity_type=params["entity_type"])
    if params.get("entity_id"):
        queryset = queryset.filter(entity_id=params["entity_id"])
    if params.get("actor_id"):
        queryset = queryset.filter(actor__user_id=params["actor_id"])
    if params.get("action"):
        queryset = queryset.filter(action=params["action"])
    if params.get("from"):
        queryset = queryset.filter(timestamp__date__gte=_parse_day(params["from"]))
    if params.get("to"):
        queryset = queryset.filter(timestamp__date__lte=_parse_day(params["to"]))
    return queryset


def _iso_z(value) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _coding_history(events) -> list:
    history = []
    for event in events:
        for change in (event.evidence or {}).get("coding_changes") or []:
            after = change.get("after") or {}
            history.append(
                {
                    "line_no": change.get("line_no"),
                    "gl_account": after.get("gl_account"),
                    "department_id": after.get("department_id"),
                    "changed_by_id": event.actor.user_id if event.actor else None,
                    "changed_at": _iso_z(event.timestamp),
                    "source": "MANUAL",
                }
            )
    return history


def invoice_trace(invoice) -> dict:
    """Compose the audit-ready invoice trace (contract §9)."""
    from apps.invoices.serializers import ApprovalStepSerializer, InvoiceSerializer
    from apps.payments.serializers import PaymentSerializer

    payments = list(
        invoice.payments.select_related(
            "vendor", "prepared_by", "released_by"
        ).all()
    )
    payment_ids = [payment.payment_id for payment in payments]

    events = list(
        AuditEvent.objects.filter(
            Q(entity_type="INVOICE", entity_id=invoice.invoice_id)
            | Q(entity_type="PAYMENT", entity_id__in=payment_ids)
        )
        .select_related("actor")
        .order_by("timestamp")
    )

    return {
        "invoice_id": invoice.invoice_id,
        "invoice": InvoiceSerializer(invoice).data,
        "approvals": ApprovalStepSerializer(
            invoice.approval_steps.all(), many=True
        ).data,
        "payments": PaymentSerializer(payments, many=True).data,
        "coding_history": _coding_history(events),
        "events": AuditEventSerializer(events, many=True).data,
    }
