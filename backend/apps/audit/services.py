"""Append-only audit helper (AGENTS.md §2, feature #8).

``record_audit`` creates an ``AuditEvent`` row. Callers wrap it in the same
``transaction.atomic()`` block as the change it describes so the event is
committed or rolled back with the action.
"""

from apps.audit.models import AuditEvent


def record_audit(
    actor,
    action: str,
    entity_type: str,
    entity_id: str,
    before: dict | None = None,
    after: dict | None = None,
    evidence: dict | None = None,
) -> AuditEvent:
    return AuditEvent.objects.create(
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=before or {},
        after=after or {},
        evidence=evidence or {},
    )
