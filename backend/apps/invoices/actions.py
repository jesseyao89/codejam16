"""Write-path orchestration for invoices (upload, analyze, patch, resolve, submit).

Services enforce authorization, perform state transitions, and write audit events
atomically. Pure analysis logic stays in ``automation/``.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from apps.accounts.exceptions import InvalidStateTransition, ValidationBlocked
from apps.accounts.models import Department, User
from apps.approvals.models import ApprovalStep
from apps.audit.models import AuditEvent
from apps.audit.services import record_audit
from apps.invoices import findings as findings_mod
from apps.invoices.models import GLAccount, Invoice, InvoiceLine
from apps.invoices.services import build_reference_data, resolve_vendor
from apps.payments.models import Payment
from apps.vendors.models import Contract, PurchaseOrder, Vendor
from automation.extraction import extract_invoice
from automation.pipeline import analyze_invoice

# Roles allowed to edit/correct invoices (contract §5.5, §2.2).
_EDIT_ROLES = {"AP_CLERK", "FINANCE_MANAGER", "CONTROLLER"}
_FULL_READ_ROLES = {"AP_CLERK", "FINANCE_MANAGER", "CONTROLLER", "AUDITOR"}


def _to_decimal(value):
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _to_date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except (ValueError, TypeError):
        return None


def next_invoice_id() -> str:
    """Return the next synthetic invoice id in the ``AP-00001`` sequence."""
    max_n = 0
    for value in Invoice.objects.filter(invoice_id__startswith="AP-").values_list(
        "invoice_id", flat=True
    ):
        try:
            max_n = max(max_n, int(value.split("-", 1)[1]))
        except (ValueError, IndexError):
            continue
    return f"AP-{max_n + 1:05d}"


def visible_invoices(user):
    """The invoice queryset a role is allowed to see (contract §2.2)."""
    queryset = Invoice.objects.select_related(
        "vendor", "department", "requester", "po", "contract"
    ).prefetch_related(
        "lines__gl_account", "lines__department", "approval_steps__approver"
    )
    if user.role in _FULL_READ_ROLES:
        return queryset
    if user.role == "APPROVER":
        return queryset.filter(department=user.department)
    if user.role == "EMPLOYEE":
        return queryset.filter(requester=user)
    return queryset.none()


def dashboard_summary(user) -> dict:
    """Role-aware dashboard counts and queues (contract §9)."""
    visible = visible_invoices(user)
    visible_ids = visible.values_list("invoice_id", flat=True)

    pending_approvals = (
        ApprovalStep.objects.filter(
            approver=user,
            action="",
            invoice__status=Invoice.Status.PENDING_APPROVAL,
        )
        .select_related("approver", "invoice")
        .order_by("invoice_id", "step_no")
    )
    payments_due = Payment.objects.filter(
        status__in=("PREPARED", "SCHEDULED", "scheduled", "outstanding"),
        invoice_id__in=visible_ids,
    )

    return {
        "role": user.role,
        "counts": {
            "my_submissions": Invoice.objects.filter(requester=user).count(),
            "in_review": visible.filter(status=Invoice.Status.REVIEW).count(),
            "pending_my_approval": pending_approvals.count(),
            "payments_due": payments_due.count(),
            "open_findings": visible.filter(
                validation_status__in=("WARNING", "BLOCKED")
            ).count(),
            "vendors_pending_review": Vendor.objects.filter(
                status="pending_review"
            ).count(),
        },
        "pending_approvals": pending_approvals,
        # Populated by the payments slice; the dashboard UI reads the count.
        "payments_due": [],
        "recent_activity": (
            AuditEvent.objects.select_related("actor")
            .filter(entity_type="INVOICE", entity_id__in=visible_ids)
            .order_by("-timestamp")[:10]
        ),
    }


# --- Analysis ---------------------------------------------------------------


def to_invoice_data(invoice) -> dict:
    """Build the dict shape the automation ``analyze_invoice`` expects."""
    return {
        "vendor_id": invoice.vendor_id,
        "vendor_name": invoice.vendor.legal_name if invoice.vendor else None,
        "invoice_number": invoice.vendor_invoice_number,
        "invoice_date": invoice.invoice_date.isoformat() if invoice.invoice_date else None,
        "currency": invoice.currency or None,
        "subtotal": str(invoice.subtotal) if invoice.subtotal is not None else None,
        "gst_hst": str(invoice.gst_hst_amount) if invoice.gst_hst_amount is not None else None,
        "pst_qst": str(invoice.pst_qst_amount) if invoice.pst_qst_amount is not None else None,
        "total": str(invoice.total) if invoice.total is not None else None,
        "po_id": invoice.po_id,
        "contract_id": invoice.contract_id,
    }


def analysis_extraction(invoice) -> dict:
    """Build the contract ``extraction`` shape from the persisted invoice."""
    from apps.invoices.tax import build_tax_lines

    lines = [
        {
            "description": line.description,
            "quantity": str(line.quantity) if line.quantity is not None else None,
            "unit_price": str(line.unit_price) if line.unit_price is not None else None,
            "amount": str(line.amount) if line.amount is not None else None,
        }
        for line in invoice.lines.all()
    ]
    return {
        "vendor_name": invoice.vendor.legal_name if invoice.vendor else None,
        "invoice_number": invoice.vendor_invoice_number or None,
        "invoice_date": invoice.invoice_date.isoformat() if invoice.invoice_date else None,
        "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
        "currency": invoice.currency or None,
        "subtotal": str(invoice.subtotal) if invoice.subtotal is not None else None,
        "tax_lines": build_tax_lines(
            invoice.gst_hst_amount, invoice.pst_qst_amount, invoice.ship_to_province
        ),
        "total": str(invoice.total) if invoice.total is not None else None,
        "line_items": lines,
    }


def run_analysis(invoice) -> dict:
    """Run the automation pipeline, persist results, and return the envelope."""
    reference = build_reference_data()
    # Never compare an invoice against itself.
    reference["historical_invoices"] = [
        row
        for row in reference["historical_invoices"]
        if row.get("invoice_id") != invoice.invoice_id
    ]
    result = analyze_invoice(to_invoice_data(invoice), reference)

    findings = list(result.get("findings") or [])
    if invoice.vendor_id is None:
        findings.append(
            {
                "code": "VENDOR_UNKNOWN",
                "severity": "BLOCK",
                "message": "The invoice vendor could not be matched to the vendor master.",
                "evidence": {"vendor_name": (invoice.raw_extraction or {}).get("vendor_name")},
            }
        )

    findings = findings_mod.attach_finding_ids(findings)
    invoice.findings = findings
    invoice.coding_suggestions = result.get("coding_suggestions") or []
    invoice.validation_status = findings_mod.compute_validation_status(findings)
    invoice.save(update_fields=["findings", "coding_suggestions", "validation_status"])

    return {
        "validation_status": invoice.validation_status,
        "findings": findings,
        "coding_suggestions": invoice.coding_suggestions,
        "extraction": analysis_extraction(invoice),
    }


# --- Upload -----------------------------------------------------------------


def _populate_from_extraction(invoice, extracted: dict) -> None:
    vendor_id = extracted.get("vendor_id")
    invoice.vendor = (
        Vendor.objects.filter(vendor_id=vendor_id).first() if vendor_id else None
    )
    invoice.vendor_invoice_number = extracted.get("invoice_number") or ""
    invoice.invoice_date = _to_date(extracted.get("invoice_date"))
    invoice.due_date = _to_date(extracted.get("due_date"))
    invoice.currency = (extracted.get("currency") or "").upper()[:3]
    invoice.subtotal = _to_decimal(extracted.get("subtotal"))
    invoice.gst_hst_amount = _to_decimal(extracted.get("gst_hst"))
    invoice.pst_qst_amount = _to_decimal(extracted.get("pst_qst"))
    invoice.total = _to_decimal(extracted.get("total"))
    invoice.ship_to_province = (extracted.get("ship_to_province") or "")[:2].upper()
    invoice.raw_extraction = extracted
    invoice.save()

    for index, item in enumerate(extracted.get("line_items") or [], start=1):
        InvoiceLine.objects.create(
            invoice=invoice,
            line_no=index,
            description=item.get("description") or "",
            quantity=_to_decimal(item.get("quantity")),
            unit_price=_to_decimal(item.get("unit_price")),
            amount=_to_decimal(item.get("amount")),
        )


def create_invoice_from_extraction(actor, extracted: dict, original_filename: str) -> Invoice:
    with transaction.atomic():
        invoice = Invoice.objects.create(
            invoice_id=next_invoice_id(),
            status=Invoice.Status.DRAFT,
            requester=actor,
        )
        _populate_from_extraction(invoice, resolve_vendor(extracted))
        run_analysis(invoice)
        record_audit(
            actor,
            "INVOICE_UPLOADED",
            "INVOICE",
            invoice.invoice_id,
            after={"status": invoice.status, "source_file": original_filename},
        )
    return invoice


def create_invoice_from_upload(actor, file) -> Invoice:
    """Save an upload, run extraction, and create the draft (2A behaviour)."""
    directory = Path(settings.MEDIA_ROOT) / "invoices"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / file.name
    with open(target, "wb") as handle:
        for chunk in file.chunks():
            handle.write(chunk)

    try:
        extracted = extract_invoice(str(target))
    except Exception as exc:  # noqa: BLE001 - extraction failure is a reviewable draft
        return create_invoice_with_extraction_failure(actor, file.name, str(exc)[:200])
    return create_invoice_from_extraction(actor, extracted, file.name)


def create_invoice_with_extraction_failure(
    actor, original_filename: str, message: str
) -> Invoice:
    with transaction.atomic():
        invoice = Invoice.objects.create(
            invoice_id=next_invoice_id(),
            status=Invoice.Status.DRAFT,
            requester=actor,
        )
        finding = {
            "code": "EXTRACTION_FAILED",
            "severity": "BLOCK",
            "message": message,
            "evidence": {"source_file": original_filename},
        }
        invoice.findings = findings_mod.attach_finding_ids([finding])
        invoice.validation_status = "BLOCKED"
        invoice.save(update_fields=["findings", "validation_status"])
        record_audit(
            actor,
            "INVOICE_UPLOADED",
            "INVOICE",
            invoice.invoice_id,
            after={"status": invoice.status, "source_file": original_filename},
        )
    return invoice


# --- Patch / resolve / submit -----------------------------------------------


def _clear_prefetch(invoice, *keys) -> None:
    cache = getattr(invoice, "_prefetched_objects_cache", None)
    if cache:
        for key in keys:
            cache.pop(key, None)


def _apply_tax_lines(invoice, tax_lines) -> None:
    federal = Decimal("0")
    provincial = Decimal("0")
    for line in tax_lines or []:
        code = (line.get("tax_code") or "").upper()
        amount = _to_decimal(line.get("amount")) or Decimal("0")
        if code in ("GST5", "HST13"):
            federal += amount
        elif code in ("PST7_BC", "QST9975"):
            provincial += amount
    invoice.gst_hst_amount = federal or None
    invoice.pst_qst_amount = provincial or None


def _apply_field(invoice, field: str, value) -> None:
    if field == "vendor_id":
        invoice.vendor = (
            Vendor.objects.filter(vendor_id=value).first() if value else None
        )
    elif field == "invoice_number":
        invoice.vendor_invoice_number = value or ""
    elif field in ("invoice_date", "received_date", "due_date"):
        setattr(invoice, field, _to_date(value))
    elif field == "currency":
        invoice.currency = (value or "").upper()[:3]
    elif field in ("subtotal", "total"):
        setattr(invoice, field, _to_decimal(value))
    elif field == "tax_lines":
        _apply_tax_lines(invoice, value)
    elif field == "ship_to_province":
        invoice.ship_to_province = (value or "")[:2].upper()
    elif field == "department_id":
        invoice.department = (
            Department.objects.filter(department_id=value).first() if value else None
        )
    elif field == "requester_id":
        invoice.requester = User.objects.filter(user_id=value).first() if value else None
    elif field == "po_id":
        invoice.po = (
            PurchaseOrder.objects.filter(po_id=value).first() if value else None
        )
    elif field == "contract_id":
        invoice.contract = (
            Contract.objects.filter(contract_id=value).first() if value else None
        )


_EDITABLE_FIELDS = {
    "vendor_id",
    "invoice_number",
    "invoice_date",
    "received_date",
    "due_date",
    "currency",
    "subtotal",
    "total",
    "tax_lines",
    "ship_to_province",
    "department_id",
    "requester_id",
    "po_id",
    "contract_id",
}


def _apply_lines(invoice, lines_data) -> list[dict]:
    changes = []
    for entry in lines_data or []:
        line_no = entry.get("line_no")
        if line_no is None:
            continue
        line = invoice.lines.filter(line_no=line_no).first()
        if line is None:
            raise ValidationError(f"Unknown line_no: {line_no}")
        before = {
            "gl_account": line.gl_account_id,
            "department_id": line.department_id,
        }
        if "gl_account" in entry:
            line.gl_account = (
                GLAccount.objects.filter(account_number=entry["gl_account"]).first()
                if entry["gl_account"]
                else None
            )
        if "department_id" in entry:
            line.department = (
                Department.objects.filter(department_id=entry["department_id"]).first()
                if entry["department_id"]
                else None
            )
        line.save()
        after = {
            "gl_account": line.gl_account_id,
            "department_id": line.department_id,
        }
        if before != after:
            changes.append({"line_no": line_no, "before": before, "after": after})
    return changes


def apply_invoice_patch(invoice, data: dict, actor) -> Invoice:
    if invoice.status not in (Invoice.Status.DRAFT, Invoice.Status.REVIEW):
        raise InvalidStateTransition()

    changed_fields = []
    for field in _EDITABLE_FIELDS:
        if field in data:
            _apply_field(invoice, field, data[field])
            changed_fields.append(field)

    lines_data = data.get("lines")
    coding_changes = []
    if lines_data is not None:
        coding_changes = _apply_lines(invoice, lines_data)
        changed_fields.append("lines")

    invoice.save()
    _clear_prefetch(invoice, "lines")
    record_audit(
        actor,
        "INVOICE_UPDATED",
        "INVOICE",
        invoice.invoice_id,
        evidence={
            "fields": sorted(changed_fields),
            "coding_changes": coding_changes,
        },
    )
    return invoice


def resolve_finding(invoice, finding_id: str, justification: str, actor) -> Invoice:
    findings = list(invoice.findings or [])
    target = None
    for finding in findings:
        if finding.get("finding_id") == finding_id:
            target = finding
            break

    if target is None:
        raise NotFound("Finding not found.")

    if target.get("severity") == "BLOCK":
        raise ValidationBlocked()
    if target.get("severity") != "WARNING":
        raise ValidationError("Only WARNING findings can be resolved.")

    target["resolution"] = {
        "status": "RESOLVED",
        "resolved_by_id": actor.user_id,
        "resolved_at": timezone.now().isoformat(),
        "justification": justification,
    }
    invoice.findings = findings
    invoice.validation_status = findings_mod.compute_validation_status(findings)
    invoice.save(update_fields=["findings", "validation_status"])

    record_audit(
        actor,
        "FINDING_RESOLVED",
        "INVOICE",
        invoice.invoice_id,
        evidence={"finding_id": finding_id, "justification": justification},
    )
    return invoice


def submit_invoice(invoice, actor) -> Invoice:
    if invoice.status not in (Invoice.Status.DRAFT, Invoice.Status.REVIEW):
        raise InvalidStateTransition()

    open_blocks = [
        finding
        for finding in (invoice.findings or [])
        if finding.get("resolution") is None and finding.get("severity") == "BLOCK"
    ]
    if open_blocks:
        raise ValidationBlocked()

    previous = invoice.status
    with transaction.atomic():
        # On resubmit, drop leftover pending steps but keep the decision history
        # (approved/rejected steps remain for the audit trail).
        ApprovalStep.objects.filter(invoice=invoice, action="").delete()
        existing_max = (
            invoice.approval_steps.aggregate(max_step=Max("step_no"))["max_step"] or 0
        )
        ApprovalStep.objects.bulk_create(
            build_approval_chain(invoice, start_step_no=existing_max + 1)
        )
        invoice.status = Invoice.Status.PENDING_APPROVAL
        invoice.save(update_fields=["status"])
        _clear_prefetch(invoice, "approval_steps")
        record_audit(
            actor,
            "INVOICE_SUBMITTED",
            "INVOICE",
            invoice.invoice_id,
            before={"status": previous},
            after={"status": invoice.status},
        )
    return invoice


def _next_approval_ids(count: int) -> list[str]:
    # Opaque, collision-free ids. Avoid reusing freed numeric ids so audit
    # references can never be confused with a later step.
    return [f"APR-{uuid4().hex[:12].upper()}" for _ in range(count)]


def build_approval_chain(invoice, start_step_no: int = 1) -> list[ApprovalStep]:
    """Deterministic baseline routing (docs/decisions.md).

    The first step is the department manager (escalated past a self-approval);
    the next is FINANCE_MANAGER when the amount exceeds the manager's limit or
    the vendor is not active. The full structured policy engine is a later
    slice. ``start_step_no`` keeps the step numbers increasing across resubmits.
    """
    amount_cad = invoice.total_cad if invoice.total_cad is not None else invoice.total

    manager = invoice.department.manager if invoice.department else None
    requester = invoice.requester
    approver = manager if (manager and manager != requester) else None
    if manager is None and requester and requester.manager:
        approver = requester.manager

    steps = [
        ApprovalStep(
            invoice=invoice,
            step_no=start_step_no,
            approver=approver,
            approver_role=User.Role.APPROVER,
            action="",
        )
    ]

    needs_finance = invoice.vendor is None or invoice.vendor.status != Vendor.Status.ACTIVE
    if (
        manager
        and manager.approval_limit_cad is not None
        and amount_cad is not None
    ):
        needs_finance = needs_finance or amount_cad > manager.approval_limit_cad

    if needs_finance:
        finance = (
            User.objects.filter(
                role=User.Role.FINANCE_MANAGER, status=User.Status.ACTIVE
            )
            .order_by("user_id")
            .first()
        )
        steps.append(
            ApprovalStep(
                invoice=invoice,
                step_no=start_step_no + 1,
                approver=finance,
                approver_role=User.Role.FINANCE_MANAGER,
                action="",
            )
        )

    for step, approval_id in zip(steps, _next_approval_ids(len(steps))):
        step.approval_id = approval_id
    return steps
