"""Inbox tests: loading, classification, sync, per-attachment ingest (contract §4)."""

import json
from pathlib import Path
from unittest import mock

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.audit.models import AuditEvent
from apps.inbox.loader import load_emails
from apps.inbox.models import Email, EmailAttachment
from apps.invoices.models import Invoice
from apps.vendors.models import Vendor

User = get_user_model()

pytestmark = pytest.mark.django_db

EMAILS = [
    {
        "email_id": "EM-001",
        "from_name": "Polar Freight",
        "from_address": "ar@polar.example",
        "to_address": "ap@harborline.example",
        "subject": "Facture 100",
        "received_at": "2026-10-20T08:25:00",
        "body": "Please find attached invoice 100.",
        "attachments": ["inv-100.pdf", "inv-101.pdf"],
    },
    {
        "email_id": "EM-002",
        "from_name": "Marketing",
        "from_address": "sales@example.com",
        "to_address": "ap@harborline.example",
        "subject": "Fall sale",
        "received_at": "2026-10-21T09:00:00",
        "body": "20% off chairs.",
        "attachments": [],
    },
]


def _user(uid, role):
    return User.objects.create_user(
        username=uid,
        user_id=uid,
        password="demo1234",
        role=role,
        status=User.Status.ACTIVE,
    )


def _client(user):
    api = APIClient()
    api.force_authenticate(user=user)
    return api


def _write_dataset(data_dir: Path, emails, files: dict[str, bytes]):
    (data_dir / "inbox").mkdir(parents=True, exist_ok=True)
    (data_dir / "incoming_invoices").mkdir(parents=True, exist_ok=True)
    (data_dir / "inbox" / "emails.json").write_text(json.dumps(emails))
    for name, content in files.items():
        (data_dir / "incoming_invoices" / name).write_bytes(content)


def _fake_extract(path, **_kwargs):
    name = Path(path).name
    number = "101" if "101" in name else "100"
    return {
        "vendor_name": "Polar Freight Lines Ltd.",
        "invoice_number": number,
        "invoice_date": "2026-10-20",
        "due_date": "2026-11-19",
        "currency": "CAD",
        "subtotal": "100.00",
        "gst_hst": "5.00",
        "pst_qst": "0.00",
        "total": "105.00",
        "line_items": [
            {
                "description": "Freight",
                "quantity": "1",
                "unit_price": "100.00",
                "amount": "100.00",
            }
        ],
    }


@pytest.fixture
def clerk(db):
    return _user("U004", User.Role.AP_CLERK)


@pytest.fixture
def employee(db):
    return _user("U013", User.Role.EMPLOYEE)


@pytest.fixture
def vendor(db):
    return Vendor.objects.create(
        vendor_id="V001",
        legal_name="Polar Freight Lines Ltd.",
        status=Vendor.Status.ACTIVE,
    )


def test_load_emails_classifies_and_stores_attachments(settings, tmp_path):
    settings.DATA_DIR = tmp_path
    _write_dataset(
        tmp_path,
        EMAILS,
        {"inv-100.pdf": b"%PDF", "inv-101.pdf": b"%PDF"},
    )

    assert load_emails(tmp_path) == 2

    invoice_email = Email.objects.get(email_id="EM-001")
    assert invoice_email.classification == "INVOICE"
    assert invoice_email.attachments.count() == 2

    marketing = Email.objects.get(email_id="EM-002")
    assert marketing.classification == "NOT_INVOICE"
    assert marketing.status == "ROUTED"


def test_inbox_list_scoping_and_filters(clerk, employee):
    Email.objects.create(
        email_id="EM-001", subject="Invoice", classification="INVOICE", status="NEW"
    )
    Email.objects.create(
        email_id="EM-002", subject="Sale", classification="NOT_INVOICE", status="ROUTED"
    )

    response = _client(clerk).get("/api/inbox/")
    assert response.status_code == 200
    assert response.data["count"] == 2

    filtered = _client(clerk).get("/api/inbox/?classification=INVOICE")
    assert filtered.data["count"] == 1

    assert _client(employee).get("/api/inbox/").status_code == 403


def test_sync_creates_one_draft_per_attachment(settings, tmp_path, clerk, vendor):
    settings.DATA_DIR = tmp_path
    _write_dataset(
        tmp_path,
        EMAILS,
        {"inv-100.pdf": b"%PDF", "inv-101.pdf": b"%PDF"},
    )

    with mock.patch("apps.invoices.actions.extract_invoice", side_effect=_fake_extract):
        response = _client(clerk).post("/api/inbox/sync/")

    assert response.status_code == 200
    assert response.data["ingested"] == 1
    assert response.data["routed"] == 1

    email = Email.objects.get(email_id="EM-001")
    assert email.status == "INGESTED"
    assert email.attachments.filter(invoice__isnull=False).count() == 2
    assert Invoice.objects.count() == 2

    number_one = email.attachments.get(filename="inv-100.pdf").invoice
    number_two = email.attachments.get(filename="inv-101.pdf").invoice
    assert number_one.invoice_id != number_two.invoice_id
    assert "101" in (number_two.vendor_invoice_number or "") or "101" in str(
        number_two.raw_extraction
    )

    with mock.patch("apps.invoices.actions.extract_invoice", side_effect=_fake_extract):
        second = _client(clerk).post("/api/inbox/sync/")

    assert second.data["ingested"] == 0
    assert Invoice.objects.count() == 2


def test_ingest_is_idempotent_per_attachment(settings, tmp_path, clerk, vendor):
    settings.DATA_DIR = tmp_path
    _write_dataset(
        tmp_path,
        [EMAILS[0]],
        {"inv-100.pdf": b"%PDF", "inv-101.pdf": b"%PDF"},
    )
    load_emails(tmp_path)

    with mock.patch("apps.invoices.actions.extract_invoice", side_effect=_fake_extract):
        first = _client(clerk).post("/api/inbox/EM-001/ingest/")
        assert first.status_code == 200
        assert len(first.data["invoices"]) == 2

        second = _client(clerk).post("/api/inbox/EM-001/ingest/")
        assert second.status_code == 200
        assert len(second.data["invoices"]) == 2

    assert Invoice.objects.count() == 2


def test_ingest_missing_attachment_creates_unreadable_draft(
    settings, tmp_path, clerk
):
    settings.DATA_DIR = tmp_path
    email = dict(EMAILS[0], attachments=["missing.pdf"])
    _write_dataset(tmp_path, [email], {})
    load_emails(tmp_path)

    response = _client(clerk).post("/api/inbox/EM-001/ingest/")

    assert response.status_code == 200
    invoice = Invoice.objects.get()
    assert invoice.validation_status == "BLOCKED"
    assert any(
        finding["code"] == "EXTRACTION_UNREADABLE"
        for finding in invoice.findings
    )
    attachment = EmailAttachment.objects.get(email_id="EM-001")
    assert attachment.status == "FAILED"
    assert attachment.error


def test_ingest_rejects_path_traversal(settings, tmp_path, clerk):
    settings.DATA_DIR = tmp_path
    email = dict(EMAILS[0], attachments=["../../etc/passwd"])
    _write_dataset(tmp_path, [email], {})
    load_emails(tmp_path)

    response = _client(clerk).post("/api/inbox/EM-001/ingest/")

    assert response.status_code == 200
    invoice = Invoice.objects.get()
    assert any(
        finding["code"] == "EXTRACTION_UNREADABLE"
        for finding in invoice.findings
    )


def test_dismiss_email(clerk):
    Email.objects.create(
        email_id="EM-001", subject="Invoice", classification="INVOICE", status="NEW"
    )

    response = _client(clerk).post("/api/inbox/EM-001/dismiss/")

    assert response.status_code == 204
    email = Email.objects.get(email_id="EM-001")
    assert email.status == "DISMISSED"
    assert AuditEvent.objects.filter(
        action="EMAIL_DISMISSED", entity_id="EM-001"
    ).exists()


# --- Robustness / review fixes ---------------------------------------------


def test_load_emails_tolerates_bad_rows(settings, tmp_path):
    settings.DATA_DIR = tmp_path
    rows = [
        EMAILS[0],
        {
            "email_id": "EM-003",
            "subject": "Invoice odd date",
            "received_at": "20/10/2026",  # unparseable
            "body": "invoice",
            "attachments": [{"filename": "dict-attachment.pdf"}],
        },
        "not-a-row",
        {"subject": "missing id", "attachments": []},
    ]
    _write_dataset(
        tmp_path,
        rows,
        {
            "inv-100.pdf": b"%PDF",
            "inv-101.pdf": b"%PDF",
            "dict-attachment.pdf": b"%PDF",
        },
    )

    errors = []
    count = load_emails(tmp_path, errors)

    assert count == 2
    assert errors
    assert Email.objects.get(email_id="EM-003").received_at is None
    assert EmailAttachment.objects.filter(
        email__email_id="EM-003", filename="dict-attachment.pdf"
    ).exists()


def test_load_emails_non_list_json_is_reported(settings, tmp_path):
    settings.DATA_DIR = tmp_path
    (tmp_path / "inbox").mkdir()
    (tmp_path / "inbox" / "emails.json").write_text("{}")

    errors = []
    assert load_emails(tmp_path, errors) == 0
    assert errors


def test_malformed_extraction_creates_failed_drafts(settings, tmp_path, clerk):
    settings.DATA_DIR = tmp_path
    _write_dataset(
        tmp_path,
        [EMAILS[0]],
        {"inv-100.pdf": b"%PDF", "inv-101.pdf": b"%PDF"},
    )
    load_emails(tmp_path)

    with mock.patch(
        "apps.invoices.actions.extract_invoice",
        return_value=["not", "a", "dict"],
    ):
        response = _client(clerk).post("/api/inbox/EM-001/ingest/")

    assert response.status_code == 200
    assert Invoice.objects.count() == 2
    for invoice in Invoice.objects.all():
        assert invoice.validation_status == "BLOCKED"
        assert any(
            finding["code"] == "EXTRACTION_FAILED"
            for finding in invoice.findings
        )


def test_sync_completes_partial_email(settings, tmp_path, clerk, vendor):
    settings.DATA_DIR = tmp_path
    _write_dataset(
        tmp_path,
        [EMAILS[0]],
        {"inv-100.pdf": b"%PDF", "inv-101.pdf": b"%PDF"},
    )
    load_emails(tmp_path)

    with mock.patch("apps.invoices.actions.extract_invoice", side_effect=_fake_extract):
        partial = _client(clerk).post(
            "/api/inbox/EM-001/ingest/",
            {"attachment": "inv-100.pdf"},
            format="json",
        )
    assert partial.status_code == 200
    email = Email.objects.get(email_id="EM-001")
    assert email.status == "PARTIAL"

    with mock.patch("apps.invoices.actions.extract_invoice", side_effect=_fake_extract):
        sync = _client(clerk).post("/api/inbox/sync/")

    assert sync.data["ingested"] == 1
    email.refresh_from_db()
    assert email.status == "INGESTED"
    assert email.attachments.filter(invoice__isnull=False).count() == 2
    assert Invoice.objects.count() == 2


def test_terminated_user_denied(db):
    user = _user("U099", User.Role.AP_CLERK)
    user.is_active = False
    user.save(update_fields=["is_active"])

    assert _client(user).get("/api/inbox/").status_code == 403


def test_ingest_not_invoice_rejected(clerk):
    Email.objects.create(
        email_id="EM-002",
        subject="Sale",
        classification="NOT_INVOICE",
        status="ROUTED",
    )

    response = _client(clerk).post("/api/inbox/EM-002/ingest/")

    assert response.status_code == 409
    assert response.data["error"]["code"] == "INVALID_STATE_TRANSITION"
