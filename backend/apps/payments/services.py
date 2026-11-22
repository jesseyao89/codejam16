"""Payment orchestration (contract §8).

Prepare → release (simulated execution). Release is idempotent, enforces CAD
limits and separation of duties, and sets the invoice PAID in the same
transaction.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.exceptions import InvalidStateTransition, LimitExceeded
from apps.approvals.models import ApprovalStep
from apps.audit.services import record_audit
from apps.invoices.models import Invoice
from apps.payments.models import Payment

_PAYABLE_STATUSES = (Payment.Status.PREPARED, Payment.Status.SCHEDULED)
_RELEASE_ROLES = {"FINANCE_MANAGER", "CONTROLLER"}
_FINANCE_LIMIT = Decimal("100000.00")


def payments_visible_to(user):
    """Payments on invoices the user is allowed to see."""
    from apps.invoices.actions import visible_invoices

    invoice_ids = visible_invoices(user).values_list("invoice_id", flat=True)
    return Payment.objects.filter(invoice_id__in=invoice_ids)


def _next_payment_id() -> str:
    return f"PAY-{uuid4().hex[:12].upper()}"


def _amount_cad(invoice) -> Decimal:
    if invoice.total_cad is not None:
        return invoice.total_cad
    if (invoice.currency or "CAD").upper() == "CAD":
        if invoice.total is None:
            raise ValidationError("Invoice total is missing.")
        return invoice.total
    raise ValidationError(
        "Cannot prepare a foreign-currency payment without a CAD amount/FX rate."
    )


def prepare_payment(invoice, actor) -> Payment:
    if invoice.status != Invoice.Status.APPROVED:
        raise InvalidStateTransition(
            "Only approved invoices can be prepared for payment."
        )

    amount_cad = _amount_cad(invoice)

    with transaction.atomic():
        existing = invoice.payments.filter(status__in=_PAYABLE_STATUSES).first()
        if existing:
            return existing

        payment = Payment.objects.create(
            payment_id=_next_payment_id(),
            invoice=invoice,
            vendor=invoice.vendor,
            method=(
                invoice.vendor.preferred_payment_method
                if invoice.vendor and invoice.vendor.preferred_payment_method
                else "EFT"
            ),
            scheduled_date=invoice.due_date,
            currency=invoice.currency or "CAD",
            amount=invoice.total,
            fx_rate_to_cad=invoice.fx_rate_to_cad,
            amount_cad=amount_cad,
            status=Payment.Status.PREPARED,
            prepared_by=actor,
        )
        record_audit(
            actor,
            "PAYMENT_PREPARED",
            "PAYMENT",
            payment.payment_id,
            after={
                "status": payment.status,
                "invoice_id": invoice.invoice_id,
                "amount_cad": str(amount_cad),
            },
        )
    return payment


def release_payment(payment, actor) -> Payment:
    if actor.role not in _RELEASE_ROLES:
        raise PermissionDenied(
            "Only Finance Managers and Controllers can release payments."
        )

    with transaction.atomic():
        locked = (
            Payment.objects.select_for_update()
            .select_related("invoice", "vendor")
            .get(pk=payment.pk)
        )

        # Idempotent: a retry returns the already-paid payment.
        if locked.status == Payment.Status.PAID:
            return locked

        if locked.status not in _PAYABLE_STATUSES:
            raise InvalidStateTransition("This payment cannot be released.")

        invoice = locked.invoice
        if invoice and invoice.status == Invoice.Status.PAID:
            raise InvalidStateTransition("The invoice is already paid.")
        if (
            invoice
            and ApprovalStep.objects.filter(
                invoice=invoice, approver=actor, action="approved"
            ).exists()
        ):
            raise PermissionDenied(
                "You cannot release a payment for an invoice you approved."
            )

        amount_cad = locked.amount_cad or Decimal("0")
        if actor.role == "FINANCE_MANAGER" and amount_cad > _FINANCE_LIMIT:
            raise LimitExceeded()

        previous = locked.status
        locked.status = Payment.Status.PAID
        locked.paid_date = timezone.localdate()
        locked.released_by = actor
        locked.save(update_fields=["status", "paid_date", "released_by"])

        if invoice and invoice.status != Invoice.Status.PAID:
            invoice.status = Invoice.Status.PAID
            invoice.save(update_fields=["status"])

        record_audit(
            actor,
            "PAYMENT_RELEASED",
            "PAYMENT",
            locked.payment_id,
            before={"status": previous},
            after={
                "status": locked.status,
                "invoice_status": invoice.status if invoice else None,
            },
            evidence={
                "amount_cad": str(amount_cad),
                "limit": str(_FINANCE_LIMIT) if actor.role == "FINANCE_MANAGER" else None,
            },
        )
    return locked


def cancel_payment(payment, actor) -> Payment:
    with transaction.atomic():
        locked = (
            Payment.objects.select_for_update()
            .select_related("invoice")
            .get(pk=payment.pk)
        )
        if locked.status == Payment.Status.CANCELLED:
            return locked
        if locked.status not in _PAYABLE_STATUSES:
            raise InvalidStateTransition(
                "Only prepared or scheduled payments can be cancelled."
            )

        previous = locked.status
        locked.status = Payment.Status.CANCELLED
        locked.save(update_fields=["status"])
        record_audit(
            actor,
            "PAYMENT_CANCELLED",
            "PAYMENT",
            locked.payment_id,
            before={"status": previous},
            after={"status": locked.status},
        )
    return locked
