"""Service layer that orchestrates the pure ``automation`` modules.

This is the boundary between Django (models, authorization, transactions) and
``automation/`` (pure dict-in / dict-out functions). It serializes ORM objects
into the dict shapes the automation modules expect, and normalizes extracted
invoice data. It never mutates approval/payment state.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal

from apps.accounts.models import Department
from apps.invoices.models import GLAccount, Invoice, InvoiceLine
from apps.payments.models import Payment
from apps.vendors.models import BankChange, Contract, PurchaseOrder, Vendor


def _iso(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def _serialize(obj: dict) -> dict:
    return {k: _iso(v) for k, v in obj.items()}


def build_reference_data(
    vendor_id: str | None = None,
    exclude_invoice_id: str | None = None,
) -> dict:
    """Build the ``reference_data`` dict consumed by ``analyze_invoice``.

    ``vendor_id`` scopes the historical coding lines to the vendor being
    analyzed; ``exclude_invoice_id`` keeps an invoice from matching itself.
    """
    # Payment method per invoice (prefer CARD when an invoice has several), so
    # duplicate findings can surface "already paid by card" evidence.
    payment_methods: dict[str, str] = {}
    for row in Payment.objects.values("invoice_id", "method"):
        invoice_id = row["invoice_id"]
        if not invoice_id:
            continue
        if payment_methods.get(invoice_id) == "CARD":
            continue
        payment_methods[invoice_id] = row["method"]

    historical = []
    for row in Invoice.objects.values(
        "invoice_id",
        "vendor_id",
        "vendor_invoice_number",
        "total",
        "currency",
        "invoice_date",
    ):
        item = _serialize(row)
        item["invoice_number"] = item["vendor_invoice_number"]
        item["payment_method"] = payment_methods.get(row["invoice_id"])
        historical.append(item)

    bank_changes = [
        dict(
            change_id=bc.change_id,
            vendor_id=bc.vendor_id,
            changed_at=bc.changed_at.isoformat() if bc.changed_at else None,
            request_channel=bc.request_channel,
            verified_by_callback=bc.verified_by_callback,
            status=bc.status,
        )
        for bc in BankChange.objects.all()
    ]

    purchase_orders = [
        dict(
            po_id=po.po_id,
            vendor_id=po.vendor_id,
            currency=po.currency,
            total_amount=str(po.total_amount) if po.total_amount is not None else None,
        )
        for po in PurchaseOrder.objects.all()
    ]

    contracts = [
        dict(
            contract_id=c.contract_id,
            vendor_id=c.vendor_id,
            currency=c.currency,
            status=c.status,
            start_date=c.start_date.isoformat() if c.start_date else None,
            end_date=c.end_date.isoformat() if c.end_date else None,
            billing_type=c.billing_type,
            monthly_fee=str(c.monthly_fee) if c.monthly_fee is not None else None,
        )
        for c in Contract.objects.all()
    ]

    gl_accounts = [
        dict(
            account_number=a.account_number,
            name=a.name,
            account_type=a.account_type,
        )
        for a in GLAccount.objects.all()
    ]

    line_queryset = InvoiceLine.objects.values(
        "invoice_id",
        "invoice__vendor_id",
        "description",
        "gl_account_id",
        "department_id",
        "line_type",
    )
    if vendor_id:
        line_queryset = line_queryset.filter(invoice__vendor_id=vendor_id)
    if exclude_invoice_id:
        line_queryset = line_queryset.exclude(invoice_id=exclude_invoice_id)

    historical_lines = [
        dict(
            invoice_id=row["invoice_id"],
            vendor_id=row["invoice__vendor_id"],
            description=row["description"],
            gl_account=row["gl_account_id"],
            department_id=row["department_id"],
            line_type=row["line_type"],
        )
        for row in line_queryset
    ]

    departments = [
        dict(department_id=d.department_id, name=d.name)
        for d in Department.objects.all()
    ]

    return {
        "historical_invoices": historical,
        "historical_lines": historical_lines,
        "bank_changes": bank_changes,
        "purchase_orders": purchase_orders,
        "contracts": contracts,
        "gl_accounts": gl_accounts,
        "departments": departments,
    }


def _normalize_name(value) -> str:
    if not value:
        return ""
    value = value.lower()
    value = re.sub(r"[^a-z0-9 ]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def resolve_vendor(extracted: dict) -> dict:
    """Best-effort map of the extracted ``vendor_name`` to a master ``vendor_id``.

    The extraction module emits ``vendor_name`` (free text from the document);
    the matching/fraud/duplicate modules key off ``vendor_id``. Without this
    resolution those checks silently no-op. Exact normalized match only for
    now; fuzzy/near-match is a follow-up.
    """
    name = extracted.get("vendor_name")
    if not name:
        return extracted
    target = _normalize_name(name)
    if not target:
        return extracted

    for vendor in Vendor.objects.all():
        if _normalize_name(vendor.legal_name) == target:
            extracted["vendor_id"] = vendor.vendor_id
            break
    return extracted
