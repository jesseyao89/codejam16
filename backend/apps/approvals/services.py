"""Approval decision service (contract §7).

Sequential approvals with delegation, separation of duties, and audit events.
The current pending step is the lowest ``step_no`` with no decision; only that
step can be acted on.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from apps.accounts.exceptions import InvalidStateTransition, SelfApprovalBlocked
from apps.approvals.models import ApprovalStep
from apps.audit.services import record_audit
from apps.invoices.models import Invoice

_ACTIVE_DELEGATE = "on_leave"


def approvals_visible_to(user):
    """Approval steps on invoices the user is allowed to see."""
    from apps.invoices.actions import visible_invoices

    invoice_ids = visible_invoices(user).values_list("invoice_id", flat=True)
    return ApprovalStep.objects.filter(invoice_id__in=invoice_ids)


def current_pending_step(invoice):
    return (
        invoice.approval_steps.filter(action="").order_by("step_no").first()
    )


def _resolve_actor(step, user):
    """Return the principal when acting as a delegate, else ``None``."""
    if step.approver_id is not None:
        if step.approver_id == user.id:
            return None
        if (
            step.approver.delegate_id == user.id
            and step.approver.status == _ACTIVE_DELEGATE
            and user.status == "active"
        ):
            return step.approver
        raise PermissionDenied("You are not the approver for this step.")

    # Unassigned step: fall back to any active user with the required role.
    if (
        step.approver_role
        and user.role == step.approver_role
        and user.status == "active"
    ):
        return None
    raise PermissionDenied("You are not the approver for this step.")


def _validate(step, user):
    invoice = step.invoice
    if invoice.status != Invoice.Status.PENDING_APPROVAL:
        raise InvalidStateTransition()
    if step.action:
        raise InvalidStateTransition()

    current = current_pending_step(invoice)
    if current is None or current.approval_id != step.approval_id:
        raise InvalidStateTransition()

    if invoice.requester_id == user.id:
        raise SelfApprovalBlocked()

    return _resolve_actor(step, user)


def _decide(step, user, action: str, comment: str):
    with transaction.atomic():
        locked = (
            ApprovalStep.objects.select_for_update()
            .select_related("invoice", "approver")
            .get(pk=step.pk)
        )
        delegated_for = _validate(locked, user)

        claimed = ApprovalStep.objects.filter(pk=locked.pk, action="").update(
            action=action,
            acted_at=timezone.now(),
            comment=(comment or "")[:255],
            delegated_for=delegated_for,
        )
        if not claimed:
            raise InvalidStateTransition()

        invoice = locked.invoice
        previous = invoice.status
        if action == "approved":
            remaining = (
                invoice.approval_steps.filter(action="")
                .exclude(pk=locked.pk)
                .exists()
            )
            if not remaining:
                invoice.status = Invoice.Status.APPROVED
                invoice.save(update_fields=["status"])
            event = "APPROVAL_APPROVED"
        else:
            invoice.status = Invoice.Status.REVIEW
            invoice.save(update_fields=["status"])
            event = "APPROVAL_REJECTED"

        record_audit(
            user,
            event,
            "INVOICE",
            invoice.invoice_id,
            before={"status": previous},
            after={
                "status": invoice.status,
                "approval_id": locked.approval_id,
                "step_no": locked.step_no,
            },
            evidence={
                "comment": comment or "",
                "on_behalf_of": delegated_for.user_id if delegated_for else None,
            },
        )

    return invoice


def approve(step, user, comment: str = "") -> Invoice:
    return _decide(step, user, "approved", comment)


def reject(step, user, comment: str = "") -> Invoice:
    return _decide(step, user, "rejected", comment)
