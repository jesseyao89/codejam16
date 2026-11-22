"""Invoice read/write path tests (contract §4, §5)."""

from decimal import Decimal
from io import StringIO
from unittest import mock

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.accounts.models import Department
from apps.approvals.models import ApprovalStep
from apps.invoices.findings import attach_finding_ids
from apps.invoices.models import GLAccount, Invoice, InvoiceLine, TaxCode
from apps.vendors.models import Contract, PurchaseOrder, Vendor

User = get_user_model()

EXTRACTED = {
    "vendor_name": "Polar Freight Lines Ltd.",
    "invoice_number": "INV-200",
    "invoice_date": "2026-09-01",
    "due_date": "2026-10-01",
    "currency": "CAD",
    "subtotal": "100.00",
    "gst_hst": "5.00",
    "pst_qst": "0.00",
    "total": "105.00",
    "line_items": [
        {"description": "Freight", "quantity": "1", "unit_price": "100.00", "amount": "100.00"}
    ],
}


@pytest.fixture
def ap_clerk(db):
    return User.objects.create_user(
        username="U004",
        user_id="U004",
        password="demo1234",
        role=User.Role.AP_CLERK,
        status=User.Status.ACTIVE,
    )


@pytest.fixture
def client(ap_clerk):
    api = APIClient()
    api.force_authenticate(user=ap_clerk)
    return api


@pytest.fixture
def vendor(db):
    return Vendor.objects.create(
        vendor_id="V015",
        legal_name="Polar Freight Lines Ltd.",
        status=Vendor.Status.ACTIVE,
    )


# --- Read -------------------------------------------------------------------


@pytest.mark.django_db
def test_invoice_list_is_role_scoped(ap_clerk):
    other = User.objects.create_user(
        username="U013",
        user_id="U013",
        password="x",
        role=User.Role.EMPLOYEE,
        status=User.Status.ACTIVE,
    )
    Invoice.objects.create(invoice_id="AP-00001", requester=ap_clerk, status="DRAFT")
    Invoice.objects.create(invoice_id="AP-00002", requester=other, status="DRAFT")

    clerk_client = APIClient()
    clerk_client.force_authenticate(user=ap_clerk)
    assert clerk_client.get("/api/invoices/").data["count"] == 2

    employee_client = APIClient()
    employee_client.force_authenticate(user=other)
    assert employee_client.get("/api/invoices/").data["count"] == 1


@pytest.mark.django_db
def test_invoice_detail_returns_contract_shape(client, vendor, ap_clerk):
    dept = Department.objects.create(department_id="D01", name="Operations")
    invoice = Invoice.objects.create(
        invoice_id="AP-00001",
        vendor=vendor,
        vendor_invoice_number="INV-1",
        invoice_date="2026-09-01",
        currency="CAD",
        subtotal="100.00",
        gst_hst_amount="5.00",
        pst_qst_amount="0.00",
        total="105.00",
        department=dept,
        requester=ap_clerk,
        status="DRAFT",
    )
    InvoiceLine.objects.create(
        invoice=invoice, line_no=1, description="Freight", amount="100.00"
    )
    invoice.findings = attach_finding_ids(
        [{"code": "POSSIBLE_DUPLICATE", "severity": "WARNING", "message": "dup", "evidence": {}}]
    )
    invoice.validation_status = "WARNING"
    invoice.save()

    response = client.get(f"/api/invoices/{invoice.invoice_id}/")

    assert response.status_code == 200
    data = response.data
    assert data["id"] == "AP-00001"
    assert data["tax_lines"][0]["tax_code"] == "GST5"
    assert data["findings"][0]["finding_id"].startswith("F-")
    assert data["findings"][0]["resolution"] is None
    assert data["lines"][0]["gl_account"] is None
    assert data["approvals"] == []


# --- Upload -----------------------------------------------------------------


@pytest.mark.django_db
def test_upload_creates_draft(client, vendor, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    upload = SimpleUploadedFile("inv.pdf", b"%PDF-1.4 fake")

    with mock.patch("apps.invoices.actions.extract_invoice", return_value=EXTRACTED):
        response = client.post(
            "/api/invoices/upload/", {"file": upload}, format="multipart"
        )

    assert response.status_code == 201
    data = response.data
    assert data["status"] == "DRAFT"
    assert data["vendor"]["id"] == "V015"
    assert data["invoice_number"] == "INV-200"
    assert len(data["lines"]) == 1
    assert data["lines"][0]["amount"] == "100.00"
    assert data["validation_status"] == "PASSED"
    assert data["findings"] == []


@pytest.mark.django_db
def test_upload_extraction_failure_creates_blocked_draft(client, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    upload = SimpleUploadedFile("bad.pdf", b"not really")

    with mock.patch(
        "apps.invoices.actions.extract_invoice",
        side_effect=ValueError("No readable text found in the PDF."),
    ):
        response = client.post(
            "/api/invoices/upload/", {"file": upload}, format="multipart"
        )

    assert response.status_code == 201
    assert response.data["status"] == "DRAFT"
    assert response.data["validation_status"] == "BLOCKED"
    assert any(
        finding["code"] == "EXTRACTION_FAILED" for finding in response.data["findings"]
    )


@pytest.mark.django_db
def test_upload_corrupt_file_creates_unreadable_draft(client, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    upload = SimpleUploadedFile("corrupt.pdf", b"not a real pdf")

    response = client.post(
        "/api/invoices/upload/", {"file": upload}, format="multipart"
    )

    assert response.status_code == 201
    assert response.data["status"] == "DRAFT"
    assert response.data["validation_status"] == "BLOCKED"
    assert any(
        finding["code"] == "EXTRACTION_UNREADABLE"
        for finding in response.data["findings"]
    )


@pytest.mark.django_db
def test_upload_persists_extracted_tax_lines(client, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    TaxCode.objects.create(code="HST13", description="Ontario HST", rate="0.13")
    TaxCode.objects.create(code="QST9975", description="Quebec QST", rate="0.09975")
    upload = SimpleUploadedFile("tax.pdf", b"%PDF-1.4 fake")
    extracted = dict(
        EXTRACTED,
        invoice_number="INV-TAX",
        gst_hst=None,
        pst_qst=None,
        total="122.98",
        tax_lines=[
            {"tax_code": "HST13", "amount": "13.00"},
            {"tax_code": "QST9975", "amount": "9.98"},
        ],
        line_items=[],
    )

    with mock.patch(
        "apps.invoices.actions.extract_invoice", return_value=extracted
    ):
        response = client.post(
            "/api/invoices/upload/", {"file": upload}, format="multipart"
        )

    assert response.status_code == 201
    assert response.data["tax_lines"] == [
        {"tax_code": "HST13", "rate": "0.13", "amount": "13.00"},
        {"tax_code": "QST9975", "rate": "0.09975", "amount": "9.98"},
    ]


@pytest.mark.django_db
def test_upload_resolves_extracted_po_and_contract(
    client, settings, tmp_path, vendor
):
    settings.MEDIA_ROOT = tmp_path
    vendor.country = "CA"
    vendor.province_or_state = "ON"
    vendor.save(update_fields=["country", "province_or_state"])
    TaxCode.objects.create(code="HST13", description="Ontario HST", rate="0.13")
    po = PurchaseOrder.objects.create(
        po_id="PO-1",
        vendor=vendor,
        currency="CAD",
        total_amount="1000.00",
        status="open",
    )
    contract = Contract.objects.create(
        contract_id="C001",
        vendor=vendor,
        currency="CAD",
        status="active",
        start_date="2026-01-01",
        end_date="2026-12-31",
        billing_type="blanket",
    )
    upload = SimpleUploadedFile("refs.pdf", b"%PDF-1.4 fake")
    extracted = dict(
        EXTRACTED,
        po_number=po.po_id,
        contract_reference=contract.contract_id,
        ship_to_province="ON",
        gst_hst="13.00",
        total="113.00",
        line_items=[],
    )

    with mock.patch(
        "apps.invoices.actions.extract_invoice", return_value=extracted
    ):
        response = client.post(
            "/api/invoices/upload/", {"file": upload}, format="multipart"
        )

    assert response.status_code == 201
    assert response.data["po_id"] == "PO-1"
    assert response.data["contract_id"] == "C001"
    assert response.data["validation_status"] == "PASSED"


@pytest.mark.django_db
def test_upload_unresolved_po_reference_blocks(client, settings, tmp_path, vendor):
    settings.MEDIA_ROOT = tmp_path
    upload = SimpleUploadedFile("missing-po.pdf", b"%PDF-1.4 fake")
    extracted = dict(
        EXTRACTED,
        po_number="PO-MISSING",
        line_items=[],
    )

    with mock.patch(
        "apps.invoices.actions.extract_invoice", return_value=extracted
    ):
        response = client.post(
            "/api/invoices/upload/", {"file": upload}, format="multipart"
        )

    assert response.status_code == 201
    assert response.data["po_id"] is None
    assert response.data["validation_status"] == "BLOCKED"
    assert any(
        finding["code"] == "PO_NOT_FOUND"
        for finding in response.data["findings"]
    )


@pytest.mark.django_db
def test_analyze_flags_tax_mismatch(client, vendor):
    vendor.country = "CA"
    vendor.province_or_state = "ON"
    vendor.save(update_fields=["country", "province_or_state"])
    TaxCode.objects.create(code="HST13", description="Ontario HST", rate="0.13")
    invoice = Invoice.objects.create(
        invoice_id="AP-00001",
        vendor=vendor,
        vendor_invoice_number="INV-TAX",
        invoice_date="2026-09-01",
        currency="CAD",
        subtotal="100.00",
        gst_hst_amount="5.00",
        pst_qst_amount="0.00",
        total="105.00",
        ship_to_province="ON",
        status="DRAFT",
    )

    response = client.post(f"/api/invoices/{invoice.invoice_id}/analyze/")

    assert response.status_code == 200
    assert response.data["validation_status"] == "BLOCKED"
    assert any(
        finding["code"] == "TAX_RATE_MISMATCH"
        and finding["severity"] == "BLOCK"
        for finding in response.data["findings"]
    )


@pytest.mark.django_db
def test_upload_does_not_escape_media_directory(
    client, settings, tmp_path, vendor
):
    settings.MEDIA_ROOT = tmp_path
    upload = SimpleUploadedFile("../../evil.pdf", b"%PDF-1.4 fake")

    with mock.patch(
        "apps.invoices.actions.extract_invoice", return_value=EXTRACTED
    ):
        response = client.post(
            "/api/invoices/upload/", {"file": upload}, format="multipart"
        )

    assert response.status_code == 201
    assert not (tmp_path.parent / "evil.pdf").exists()
    assert list((tmp_path / "invoices").glob("*.pdf"))


# --- Analyze ----------------------------------------------------------------


@pytest.mark.django_db
def test_analyze_returns_envelope(client, vendor):
    invoice = Invoice.objects.create(
        invoice_id="AP-00001",
        vendor=vendor,
        vendor_invoice_number="INV-1",
        invoice_date="2026-09-01",
        currency="CAD",
        subtotal="100.00",
        gst_hst_amount="5.00",
        pst_qst_amount="0.00",
        total="105.00",
        status="DRAFT",
    )

    response = client.post(f"/api/invoices/{invoice.invoice_id}/analyze/")

    assert response.status_code == 200
    assert set(response.data) == {
        "validation_status",
        "findings",
        "coding_suggestions",
        "extraction",
    }
    assert response.data["validation_status"] == "PASSED"
    assert response.data["extraction"]["tax_lines"][0]["tax_code"] == "GST5"


@pytest.mark.django_db
def test_analyze_suggests_coding_per_line_from_history(client, vendor):
    dept = Department.objects.create(department_id="D01", name="Operations")
    GLAccount.objects.create(
        account_number="5010", name="Freight", account_type="expense"
    )
    historical = Invoice.objects.create(
        invoice_id="AP-00099",
        vendor=vendor,
        vendor_invoice_number="INV-OLD",
        invoice_date="2026-08-01",
        currency="CAD",
        subtotal="100.00",
        gst_hst_amount="5.00",
        total="105.00",
        status="PAID",
    )
    InvoiceLine.objects.create(
        invoice=historical,
        line_no=1,
        description="Freight services Toronto",
        gl_account_id="5010",
        department=dept,
    )

    invoice = Invoice.objects.create(
        invoice_id="AP-00001",
        vendor=vendor,
        vendor_invoice_number="INV-NEW",
        invoice_date="2026-09-01",
        currency="CAD",
        subtotal="100.00",
        gst_hst_amount="5.00",
        total="105.00",
        status="DRAFT",
    )
    InvoiceLine.objects.create(
        invoice=invoice,
        line_no=1,
        description="Freight services Toronto",
        amount="100.00",
    )

    response = client.post(f"/api/invoices/{invoice.invoice_id}/analyze/")

    assert response.status_code == 200
    suggestions = response.data["coding_suggestions"]
    assert len(suggestions) == 1
    assert suggestions[0]["line_no"] == 1
    assert suggestions[0]["suggested_gl_account"] == "5010"
    assert suggestions[0]["suggested_department_id"] == "D01"
    assert "historical" in suggestions[0]["reason"].lower()


@pytest.mark.django_db
def test_analyze_does_not_use_invoice_as_its_own_coding_history(client, vendor):
    dept = Department.objects.create(department_id="D01", name="Operations")
    GLAccount.objects.create(
        account_number="5010", name="Freight", account_type="expense"
    )
    invoice = Invoice.objects.create(
        invoice_id="AP-00001",
        vendor=vendor,
        vendor_invoice_number="INV-SELF",
        invoice_date="2026-09-01",
        currency="CAD",
        subtotal="100.00",
        gst_hst_amount="5.00",
        total="105.00",
        status="DRAFT",
    )
    InvoiceLine.objects.create(
        invoice=invoice,
        line_no=1,
        description="Unique self-referential freight line",
        gl_account_id="5010",
        department=dept,
    )

    with mock.patch(
        "automation.coding.OpenAI", side_effect=RuntimeError("no key")
    ):
        response = client.post(f"/api/invoices/{invoice.invoice_id}/analyze/")

    assert response.status_code == 200
    suggestions = response.data["coding_suggestions"]
    assert len(suggestions) == 1
    assert suggestions[0]["suggested_gl_account"] is None


# --- Patch ------------------------------------------------------------------


@pytest.mark.django_db
def test_patch_updates_line_coding(client, ap_clerk):
    dept = Department.objects.create(department_id="D01", name="Operations")
    GLAccount.objects.create(account_number="5010", name="Freight", account_type="expense")
    invoice = Invoice.objects.create(
        invoice_id="AP-00001", status="DRAFT", requester=ap_clerk, department=dept
    )
    InvoiceLine.objects.create(invoice=invoice, line_no=1, description="x")

    response = client.patch(
        f"/api/invoices/{invoice.invoice_id}/",
        {"lines": [{"line_no": 1, "gl_account": "5010", "department_id": "D01"}]},
        format="json",
    )

    assert response.status_code == 200
    line = response.data["lines"][0]
    assert line["gl_account"] == "5010"
    assert line["department_id"] == "D01"


# --- Resolve finding --------------------------------------------------------


@pytest.mark.django_db
def test_resolve_warning_updates_status(client, ap_clerk):
    invoice = Invoice.objects.create(
        invoice_id="AP-00001", status="DRAFT", requester=ap_clerk
    )
    invoice.findings = attach_finding_ids(
        [{"code": "POSSIBLE_DUPLICATE", "severity": "WARNING", "message": "dup", "evidence": {"x": 1}}]
    )
    invoice.validation_status = "WARNING"
    invoice.save()
    finding_id = invoice.findings[0]["finding_id"]

    response = client.post(
        f"/api/invoices/{invoice.invoice_id}/resolve-finding/",
        {"finding_id": finding_id, "justification": "Confirmed different job"},
        format="json",
    )

    assert response.status_code == 200
    assert response.data["validation_status"] == "PASSED"
    assert response.data["findings"][0]["resolution"]["status"] == "RESOLVED"


@pytest.mark.django_db
def test_resolve_block_finding_is_blocked(client, ap_clerk):
    invoice = Invoice.objects.create(
        invoice_id="AP-00001", status="DRAFT", requester=ap_clerk
    )
    invoice.findings = attach_finding_ids(
        [{"code": "TOTAL_MISMATCH", "severity": "BLOCK", "message": "x", "evidence": {}}]
    )
    invoice.save()
    finding_id = invoice.findings[0]["finding_id"]

    response = client.post(
        f"/api/invoices/{invoice.invoice_id}/resolve-finding/",
        {"finding_id": finding_id, "justification": "x"},
        format="json",
    )

    assert response.status_code == 422
    assert response.data["error"]["code"] == "VALIDATION_BLOCKED"


# --- Submit -----------------------------------------------------------------


@pytest.mark.django_db
def test_submit_creates_approval_chain(client, ap_clerk):
    dept = Department.objects.create(department_id="D01", name="Operations")
    manager = User.objects.create_user(
        username="U007",
        user_id="U007",
        password="x",
        role=User.Role.APPROVER,
        status=User.Status.ACTIVE,
    )
    dept.manager = manager
    dept.save()
    vendor = Vendor.objects.create(vendor_id="V015", legal_name="X", status="active")
    invoice = Invoice.objects.create(
        invoice_id="AP-00001",
        status="DRAFT",
        requester=ap_clerk,
        department=dept,
        vendor=vendor,
        currency="CAD",
        subtotal="100.00",
        gst_hst_amount="5.00",
        total="105.00",
        total_cad="105.00",
    )

    response = client.post(f"/api/invoices/{invoice.invoice_id}/submit/")

    assert response.status_code == 200
    assert response.data["status"] == "PENDING_APPROVAL"
    assert len(response.data["approvals"]) == 1
    assert response.data["approvals"][0]["approver"]["id"] == "U007"
    assert response.data["approvals"][0]["reason"] == "Department manager"


@pytest.mark.django_db
def test_submit_blocked_by_block_finding(client, ap_clerk):
    invoice = Invoice.objects.create(
        invoice_id="AP-00001", status="DRAFT", requester=ap_clerk
    )
    invoice.findings = attach_finding_ids(
        [{"code": "TOTAL_MISMATCH", "severity": "BLOCK", "message": "x", "evidence": {}}]
    )
    invoice.validation_status = "BLOCKED"
    invoice.save()

    response = client.post(f"/api/invoices/{invoice.invoice_id}/submit/")

    assert response.status_code == 422
    assert response.data["error"]["code"] == "VALIDATION_BLOCKED"


@pytest.mark.django_db
def test_submit_from_approved_is_invalid_state(client, ap_clerk):
    invoice = Invoice.objects.create(
        invoice_id="AP-00001", status="APPROVED", requester=ap_clerk
    )

    response = client.post(f"/api/invoices/{invoice.invoice_id}/submit/")

    assert response.status_code == 409
    assert response.data["error"]["code"] == "INVALID_STATE_TRANSITION"


# --- Dashboard --------------------------------------------------------------


@pytest.mark.django_db
def test_dashboard_returns_uniform_counts(client, ap_clerk):
    Invoice.objects.create(
        invoice_id="AP-00001",
        requester=ap_clerk,
        status="REVIEW",
        validation_status="WARNING",
    )

    response = client.get("/api/dashboard/")

    assert response.status_code == 200
    data = response.data
    assert data["role"] == "AP_CLERK"
    assert set(data["counts"]) == {
        "my_submissions",
        "in_review",
        "pending_my_approval",
        "payments_due",
        "open_findings",
        "vendors_pending_review",
    }
    assert data["counts"]["my_submissions"] == 1
    assert data["counts"]["in_review"] == 1
    assert data["counts"]["open_findings"] == 1
    assert data["pending_approvals"] == []
    assert data["payments_due"] == []
    assert data["recent_activity"] == []


@pytest.mark.django_db
def test_dashboard_shows_pending_approvals_for_approver(db):
    approver = User.objects.create_user(
        username="U007",
        user_id="U007",
        password="x",
        role=User.Role.APPROVER,
        status=User.Status.ACTIVE,
    )
    dept = Department.objects.create(
        department_id="D01", name="Operations", manager=approver
    )
    invoice = Invoice.objects.create(
        invoice_id="AP-00001", status="PENDING_APPROVAL", department=dept
    )
    ApprovalStep.objects.create(
        invoice=invoice,
        step_no=1,
        approver=approver,
        approver_role="APPROVER",
        action="",
    )

    api = APIClient()
    api.force_authenticate(user=approver)
    response = api.get("/api/dashboard/")

    assert response.status_code == 200
    assert response.data["counts"]["pending_my_approval"] == 1
    assert len(response.data["pending_approvals"]) == 1
    assert response.data["pending_approvals"][0]["status"] == "PENDING"


# --- Contract normalization -------------------------------------------------


@pytest.mark.django_db
def test_historical_invoice_validation_status_is_null(client):
    invoice = Invoice.objects.create(
        invoice_id="AP-00001", status="PAID", validation_status=""
    )

    response = client.get(f"/api/invoices/{invoice.invoice_id}/")

    assert response.status_code == 200
    assert response.data["validation_status"] is None


@pytest.mark.django_db
def test_upload_cad_sets_total_cad_and_fx(client, vendor, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    upload = SimpleUploadedFile("inv.pdf", b"%PDF-1.4 fake")

    with mock.patch("apps.invoices.actions.extract_invoice", return_value=EXTRACTED):
        response = client.post(
            "/api/invoices/upload/", {"file": upload}, format="multipart"
        )

    assert response.status_code == 201
    assert response.data["total_cad"] == "105.00"
    assert response.data["fx_rate_to_cad"] == "1.000000"


@pytest.mark.django_db
def test_backfill_fx_fills_cad_invoice():
    invoice = Invoice.objects.create(
        invoice_id="AP-00001", currency="CAD", total="3172.79", total_cad=None
    )

    call_command("backfill_fx", stdout=StringIO())

    invoice.refresh_from_db()
    assert invoice.total_cad == Decimal("3172.79")
    assert invoice.fx_rate_to_cad == Decimal("1.0")
