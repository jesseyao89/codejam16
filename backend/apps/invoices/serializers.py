"""Serializers for reference data and invoices (contract §3, §5)."""

from datetime import timezone

from rest_framework import serializers

from apps.accounts.models import Department
from apps.approvals.models import ApprovalStep
from apps.invoices import findings as findings_mod
from apps.invoices.models import GLAccount, Invoice, InvoiceLine, TaxCode
from apps.invoices.tax import build_tax_lines
from apps.vendors.models import Vendor


class UTCDateTimeField(serializers.DateTimeField):
    """ISO-8601 UTC ending in ``Z`` (contract §1)."""

    def to_representation(self, value):
        if value is None:
            return None
        return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --- Reference data ---------------------------------------------------------


class ReferenceDepartmentSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="department_id")
    manager_id = serializers.CharField(
        source="manager.user_id", allow_null=True, read_only=True
    )

    class Meta:
        model = Department
        fields = ["id", "name", "cost_centre", "annual_budget_cad", "manager_id"]


class GLAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = GLAccount
        fields = ["account_number", "name", "account_type", "notes"]


class TaxCodeSerializer(serializers.ModelSerializer):
    rate = serializers.SerializerMethodField()

    class Meta:
        model = TaxCode
        fields = [
            "code",
            "description",
            "rate",
            "applies_to",
            "recoverable",
            "gl_account",
        ]

    def get_rate(self, obj: TaxCode) -> str | None:
        if obj.rate is None:
            return None
        return format(obj.rate.normalize(), "f")


# --- Invoices ---------------------------------------------------------------


class VendorBriefSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="vendor_id")

    class Meta:
        model = Vendor
        fields = ["id", "legal_name", "status"]


class DepartmentBriefSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="department_id")

    class Meta:
        model = Department
        fields = ["id", "name"]


class InvoiceLineSerializer(serializers.ModelSerializer):
    gl_account = serializers.SerializerMethodField()
    department_id = serializers.SerializerMethodField()

    class Meta:
        model = InvoiceLine
        fields = [
            "line_no",
            "description",
            "quantity",
            "unit_price",
            "amount",
            "gl_account",
            "department_id",
            "gst_hst_code",
            "pst_qst_code",
            "line_type",
        ]

    def get_gl_account(self, obj):
        return obj.gl_account.account_number if obj.gl_account else None

    def get_department_id(self, obj):
        return obj.department.department_id if obj.department else None


class ApprovalStepSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="approval_id")
    invoice_id = serializers.CharField(source="invoice.invoice_id", read_only=True)
    status = serializers.SerializerMethodField()
    approver = serializers.SerializerMethodField()
    delegated_for_id = serializers.SerializerMethodField()
    reason = serializers.SerializerMethodField()
    comment = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalStep
        fields = [
            "id",
            "invoice_id",
            "step_no",
            "status",
            "approver",
            "delegated_for_id",
            "comment",
            "reason",
            "acted_at",
        ]

    def get_status(self, obj):
        if obj.action == "approved":
            return "APPROVED"
        if obj.action == "rejected":
            return "REJECTED"
        return "PENDING"

    def get_approver(self, obj):
        if not obj.approver:
            return None
        return {
            "id": obj.approver.user_id,
            "full_name": obj.approver.get_full_name(),
            "role": obj.approver.role,
        }

    def get_delegated_for_id(self, obj):
        return obj.delegated_for.user_id if obj.delegated_for else None

    def get_reason(self, obj):
        if obj.reason:
            return obj.reason
        if obj.approver_role == "FINANCE_MANAGER":
            return "Above limit or requires finance review"
        if obj.approver_role == "CONTROLLER":
            return "Controller"
        return "Department manager"

    def get_comment(self, obj):
        return obj.comment or None


class InvoiceSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="invoice_id")
    vendor = VendorBriefSerializer(read_only=True)
    invoice_number = serializers.CharField(source="vendor_invoice_number")
    tax_lines = serializers.SerializerMethodField()
    department = DepartmentBriefSerializer(read_only=True)
    requester_id = serializers.SerializerMethodField()
    po_id = serializers.SerializerMethodField()
    contract_id = serializers.SerializerMethodField()
    fx_rate_date = serializers.SerializerMethodField()
    lines = InvoiceLineSerializer(many=True, read_only=True)
    findings = serializers.SerializerMethodField()
    validation_status = serializers.SerializerMethodField()
    coding_suggestions = serializers.JSONField()
    approvals = serializers.SerializerMethodField()
    created_at = UTCDateTimeField(read_only=True)
    updated_at = UTCDateTimeField(read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id",
            "status",
            "vendor",
            "invoice_number",
            "invoice_date",
            "received_date",
            "due_date",
            "currency",
            "subtotal",
            "tax_lines",
            "total",
            "fx_rate_to_cad",
            "fx_rate_date",
            "total_cad",
            "ship_to_province",
            "department",
            "requester_id",
            "po_id",
            "contract_id",
            "lines",
            "validation_status",
            "findings",
            "coding_suggestions",
            "approvals",
            "created_at",
            "updated_at",
        ]

    def get_tax_lines(self, obj):
        return build_tax_lines(
            obj.gst_hst_amount, obj.pst_qst_amount, obj.ship_to_province
        )

    def get_requester_id(self, obj):
        return obj.requester.user_id if obj.requester else None

    def get_po_id(self, obj):
        return obj.po.po_id if obj.po else None

    def get_contract_id(self, obj):
        return obj.contract.contract_id if obj.contract else None

    def get_fx_rate_date(self, obj):
        # The FX rate is the invoice-date rate (AGENTS.md §8).
        return obj.invoice_date.isoformat() if obj.invoice_date else None

    def get_findings(self, obj):
        return findings_mod.attach_finding_ids(obj.findings or [])

    def get_validation_status(self, obj):
        # Historical rows were never analyzed; report null, not "".
        return obj.validation_status or None

    def get_approvals(self, obj):
        return ApprovalStepSerializer(obj.approval_steps.all(), many=True).data
