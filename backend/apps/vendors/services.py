"""Vendor master writes and controlled bank changes (contract §6)."""

from __future__ import annotations

import re
from uuid import uuid4

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.exceptions import InvalidStateTransition
from apps.audit.services import record_audit
from apps.vendors.models import BankChange, Vendor

# Bank details are only changed through the controlled BankChange flow.
_BANK_FIELDS = {
    "bank_institution",
    "bank_transit",
    "bank_account",
    "bank_details_updated_at",
}
_EDITABLE_FIELDS = {
    "legal_name",
    "category",
    "default_gl_account",
    "address",
    "province_or_state",
    "country",
    "gst_hst_number",
    "qst_number",
    "payment_terms_days",
    "early_pay_discount",
    "preferred_payment_method",
    "accepts_card_payment",
    "ap_contact_email",
    "requires_po",
}


def next_vendor_id() -> str:
    """Return the next synthetic ``V###`` id (dataset style)."""
    max_n = 0
    for value in Vendor.objects.filter(vendor_id__startswith="V").values_list(
        "vendor_id", flat=True
    ):
        suffix = value[1:]
        if suffix.isdigit():
            max_n = max(max_n, int(suffix))
    return f"V{max_n + 1:03d}"


def _normalize_account(value) -> str:
    account = re.sub(r"[\s-]", "", str(value or "").strip())
    if not account.isdigit() or not (4 <= len(account) <= 32):
        raise ValidationError(
            {"bank_account": "Enter a 4-32 digit account number."}
        )
    return account


def create_vendor(actor, data: dict) -> Vendor:
    legal_name = str(data.get("legal_name") or "").strip()
    if not legal_name:
        raise ValidationError({"legal_name": "This field is required."})

    with transaction.atomic():
        for _ in range(3):
            try:
                with transaction.atomic():
                    vendor = Vendor.objects.create(
                        vendor_id=next_vendor_id(),
                        legal_name=legal_name,
                        status=Vendor.Status.PENDING_REVIEW,
                        onboarded_at=timezone.localdate(),
                    )
                break
            except IntegrityError:
                continue
        else:
            raise ValidationError(
                {"vendor_id": "Could not allocate a vendor id; retry."}
            )

        for field in _EDITABLE_FIELDS - {"legal_name"}:
            if field in data:
                setattr(vendor, field, data[field])
        vendor.save()
        record_audit(
            actor,
            "VENDOR_ONBOARDED",
            "VENDOR",
            vendor.vendor_id,
            after={
                "legal_name": vendor.legal_name,
                "status": vendor.status,
                "fields": sorted(data),
            },
        )
    return vendor


def update_vendor(vendor, data: dict, actor) -> Vendor:
    forbidden = set(data) & (_BANK_FIELDS | {"status", "vendor_id"})
    if forbidden:
        raise ValidationError(
            {"detail": f"Controlled fields cannot be set here: {sorted(forbidden)}"}
        )

    with transaction.atomic():
        vendor = Vendor.objects.select_for_update().get(pk=vendor.pk)
        before = {
            field: getattr(vendor, field)
            for field in data
            if field in _EDITABLE_FIELDS
        }
        for field in _EDITABLE_FIELDS:
            if field in data:
                setattr(vendor, field, data[field])
        vendor.save()
        after = {field: getattr(vendor, field) for field in before}
        record_audit(
            actor,
            "VENDOR_UPDATED",
            "VENDOR",
            vendor.vendor_id,
            before=before,
            after=after,
        )
    return vendor


def approve_vendor(vendor, actor) -> Vendor:
    with transaction.atomic():
        vendor = Vendor.objects.select_for_update().get(pk=vendor.pk)
        if vendor.status != Vendor.Status.PENDING_REVIEW:
            raise InvalidStateTransition("Only pending vendors can be approved.")
        vendor.status = Vendor.Status.ACTIVE
        vendor.save(update_fields=["status"])
        record_audit(
            actor,
            "VENDOR_APPROVED",
            "VENDOR",
            vendor.vendor_id,
            before={"status": Vendor.Status.PENDING_REVIEW},
            after={"status": vendor.status},
        )
    return vendor


def hold_vendor(vendor, actor) -> Vendor:
    with transaction.atomic():
        vendor = Vendor.objects.select_for_update().get(pk=vendor.pk)
        if vendor.status == Vendor.Status.ON_HOLD:
            return vendor
        if vendor.status != Vendor.Status.ACTIVE:
            raise InvalidStateTransition("Only active vendors can be put on hold.")
        previous = vendor.status
        vendor.status = Vendor.Status.ON_HOLD
        vendor.save(update_fields=["status"])
        record_audit(
            actor,
            "VENDOR_HELD",
            "VENDOR",
            vendor.vendor_id,
            before={"status": previous},
            after={"status": vendor.status},
        )
    return vendor


def unhold_vendor(vendor, actor) -> Vendor:
    with transaction.atomic():
        vendor = Vendor.objects.select_for_update().get(pk=vendor.pk)
        if vendor.status != Vendor.Status.ON_HOLD:
            raise InvalidStateTransition("Only on-hold vendors can be released.")
        vendor.status = Vendor.Status.ACTIVE
        vendor.save(update_fields=["status"])
        record_audit(
            actor,
            "VENDOR_UNHELD",
            "VENDOR",
            vendor.vendor_id,
            before={"status": Vendor.Status.ON_HOLD},
            after={"status": vendor.status},
        )
    return vendor


def request_bank_change(vendor, bank_account, note, actor) -> BankChange:
    account = _normalize_account(bank_account)

    with transaction.atomic():
        vendor = Vendor.objects.select_for_update().get(pk=vendor.pk)
        if BankChange.objects.filter(
            vendor=vendor, status=BankChange.Status.PENDING
        ).exists():
            raise InvalidStateTransition(
                "A bank change is already pending for this vendor."
            )

        change = BankChange.objects.create(
            change_id=f"BC-{uuid4().hex[:12].upper()}",
            vendor=vendor,
            changed_at=timezone.localdate(),
            changed_by=actor,
            request_channel="api",
            verified_by_callback="no",
            old_account_last4=(vendor.bank_account or "")[-4:],
            new_account_last4=account[-4:],
            new_bank_account=account,
            note=str(note or ""),
            status=BankChange.Status.PENDING,
        )
        record_audit(
            actor,
            "BANK_CHANGE_REQUESTED",
            "VENDOR",
            vendor.vendor_id,
            after={
                "change_id": change.change_id,
                "old_account_last4": change.old_account_last4,
                "new_account_last4": change.new_account_last4,
            },
        )
    return change


def decide_bank_change(change: BankChange, actor, approve: bool) -> BankChange:
    with transaction.atomic():
        locked = (
            BankChange.objects.select_for_update()
            .select_related("vendor")
            .get(pk=change.pk)
        )
        if locked.status != BankChange.Status.PENDING:
            raise InvalidStateTransition("This bank change has already been decided.")
        if locked.changed_by_id == actor.id:
            raise PermissionDenied("You cannot decide a bank change you requested.")

        vendor = Vendor.objects.select_for_update().get(pk=locked.vendor_id)
        if (
            BankChange.objects.filter(
                vendor=vendor, status=BankChange.Status.PENDING
            )
            .exclude(pk=locked.pk)
            .exists()
        ):
            raise InvalidStateTransition(
                "Another bank change is pending for this vendor."
            )

        if approve:
            account = _normalize_account(locked.new_bank_account)
            vendor.bank_account = account
            vendor.bank_details_updated_at = timezone.localdate()
            vendor.save(update_fields=["bank_account", "bank_details_updated_at"])
            locked.verified_by_callback = "yes"
        else:
            # Do not retain a rejected account number.
            locked.new_bank_account = ""

        locked.status = (
            BankChange.Status.APPROVED if approve else BankChange.Status.REJECTED
        )
        locked.decided_by = actor
        locked.decided_at = timezone.now()
        locked.save(
            update_fields=[
                "status",
                "decided_by",
                "decided_at",
                "verified_by_callback",
                "new_bank_account",
            ]
        )
        record_audit(
            actor,
            "BANK_CHANGE_APPROVED" if approve else "BANK_CHANGE_REJECTED",
            "VENDOR",
            vendor.vendor_id,
            before={"change_id": locked.change_id, "status": "PENDING"},
            after={
                "change_id": locked.change_id,
                "status": locked.status,
                "old_account_last4": locked.old_account_last4,
                "new_account_last4": locked.new_account_last4,
            },
        )
    return locked
