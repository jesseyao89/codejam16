"""Vendor writes and controlled bank changes (contract §6)."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from automation.fraud import detect_bank_change_risk
from apps.audit.models import AuditEvent
from apps.invoices import actions
from apps.invoices.models import Invoice
from apps.vendors.models import BankChange, Vendor

User = get_user_model()

pytestmark = pytest.mark.django_db


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


@pytest.fixture
def finance(db):
    return _user("U003", User.Role.FINANCE_MANAGER)


@pytest.fixture
def controller(db):
    return _user("U001", User.Role.CONTROLLER)


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
        bank_account="1234567890124821",
    )


def test_onboard_vendor(finance):
    response = _client(finance).post(
        "/api/vendors/", {"legal_name": "New Vendor Inc.", "category": "Freight"},
        format="json",
    )

    assert response.status_code == 201
    assert response.data["status"] == "pending_review"
    assert response.data["id"].startswith("V")
    assert response.data["onboarded_at"] is not None
    assert AuditEvent.objects.filter(action="VENDOR_ONBOARDED").exists()


def test_onboarding_requires_finance(clerk):
    response = _client(clerk).post(
        "/api/vendors/", {"legal_name": "Nope"}, format="json"
    )
    assert response.status_code == 403


def test_approve_hold_unhold(finance):
    vendor = Vendor.objects.create(
        vendor_id="V010", legal_name="Pending Co", status="pending_review"
    )

    approved = _client(finance).post("/api/vendors/V010/approve/")
    assert approved.status_code == 200
    assert approved.data["status"] == "active"

    held = _client(finance).post("/api/vendors/V010/hold/")
    assert held.status_code == 200
    assert held.data["status"] == "on_hold"

    unheld = _client(finance).post("/api/vendors/V010/unhold/")
    assert unheld.status_code == 200
    assert unheld.data["status"] == "active"

    again = _client(finance).post("/api/vendors/V010/approve/")
    assert again.status_code == 409
    assert again.data["error"]["code"] == "INVALID_STATE_TRANSITION"


def test_patch_vendor_fields(finance, vendor):
    response = _client(finance).patch(
        "/api/vendors/V001/", {"category": "Courier"}, format="json"
    )

    assert response.status_code == 200
    assert response.data["category"] == "Courier"
    assert AuditEvent.objects.filter(action="VENDOR_UPDATED").exists()


def test_patch_bank_fields_rejected(finance, vendor):
    response = _client(finance).patch(
        "/api/vendors/V001/", {"bank_account": "9999999999999933"}, format="json"
    )

    assert response.status_code == 400
    assert response.data["error"]["code"] == "VALIDATION_ERROR"


def test_bank_change_request_and_approve(clerk, finance, vendor):
    requested = _client(clerk).post(
        "/api/vendors/V001/bank-changes/",
        {"bank_account": "9999999999999933", "note": "called vendor"},
        format="json",
    )

    assert requested.status_code == 201
    data = requested.data
    assert data["status"] == "PENDING"
    assert data["new_account_last4"] == "9933"
    assert data["note"] == "called vendor"
    assert "new_bank_account" not in data
    assert "bank_account" not in data

    detail = _client(clerk).get("/api/vendors/V001/")
    assert detail.data["pending_bank_change"]["id"] == data["id"]

    approved = _client(finance).post(
        f"/api/vendors/V001/bank-changes/{data['id']}/approve/"
    )

    assert approved.status_code == 200
    assert approved.data["status"] == "APPROVED"
    assert approved.data["decided_by_id"] == "U003"

    vendor.refresh_from_db()
    assert vendor.bank_account == "9999999999999933"
    assert vendor.bank_details_updated_at is not None

    change = BankChange.objects.get(change_id=data["id"])
    assert change.verified_by_callback == "yes"
    assert AuditEvent.objects.filter(action="BANK_CHANGE_APPROVED").exists()


def test_bank_change_requester_cannot_approve(finance, vendor):
    requested = _client(finance).post(
        "/api/vendors/V001/bank-changes/",
        {"bank_account": "9999999999999933"},
        format="json",
    )

    response = _client(finance).post(
        f"/api/vendors/V001/bank-changes/{requested.data['id']}/approve/"
    )

    assert response.status_code == 403
    assert response.data["error"]["code"] == "PERMISSION_DENIED"


def test_bank_change_reject_leaves_vendor_unchanged(clerk, finance, vendor):
    requested = _client(clerk).post(
        "/api/vendors/V001/bank-changes/",
        {"bank_account": "9999999999999933"},
        format="json",
    )

    rejected = _client(finance).post(
        f"/api/vendors/V001/bank-changes/{requested.data['id']}/reject/"
    )

    assert rejected.status_code == 200
    assert rejected.data["status"] == "REJECTED"
    vendor.refresh_from_db()
    assert vendor.bank_account == "1234567890124821"


def test_double_approve_is_invalid(clerk, finance, vendor):
    requested = _client(clerk).post(
        "/api/vendors/V001/bank-changes/",
        {"bank_account": "9999999999999933"},
        format="json",
    )
    url = f"/api/vendors/V001/bank-changes/{requested.data['id']}/approve/"

    assert _client(finance).post(url).status_code == 200
    second = _client(finance).post(url)

    assert second.status_code == 409
    assert second.data["error"]["code"] == "INVALID_STATE_TRANSITION"


def test_employee_cannot_list_bank_changes(employee, vendor):
    assert _client(employee).get("/api/vendors/V001/bank-changes/").status_code == 403


def test_historical_bank_change_status_is_null(vendor, controller):
    BankChange.objects.create(change_id="BC-HIST", vendor=vendor, status=None)

    response = _client(controller).get("/api/vendors/V001/bank-changes/")

    assert response.status_code == 200
    assert response.data["results"][0]["status"] is None


def test_non_active_vendor_invoice_gets_finding():
    vendor = Vendor.objects.create(
        vendor_id="V043", legal_name="On Hold Co", status="on_hold"
    )
    invoice = Invoice.objects.create(
        invoice_id="AP-00001",
        vendor=vendor,
        status=Invoice.Status.DRAFT,
        currency="CAD",
        subtotal="100.00",
        gst_hst_amount="5.00",
        pst_qst_amount="0.00",
        total="105.00",
    )

    result = actions.run_analysis(invoice)

    assert any(
        finding["code"] == "VENDOR_ON_HOLD"
        and finding["severity"] == "BLOCK"
        for finding in result["findings"]
    )


# --- Review fixes -----------------------------------------------------------


def _invoice_for(vendor, invoice_id="AP-00001"):
    return Invoice.objects.create(
        invoice_id=invoice_id,
        vendor=vendor,
        status=Invoice.Status.DRAFT,
        currency="CAD",
        subtotal="100.00",
        gst_hst_amount="5.00",
        pst_qst_amount="0.00",
        total="105.00",
    )


def test_active_vendor_has_no_hold_finding():
    vendor = Vendor.objects.create(
        vendor_id="V050", legal_name="Active Co", status="active"
    )
    result = actions.run_analysis(_invoice_for(vendor))
    assert not any(
        finding["code"] == "VENDOR_ON_HOLD" for finding in result["findings"]
    )


def test_pending_review_vendor_gets_finding():
    vendor = Vendor.objects.create(
        vendor_id="V051", legal_name="Pending Co", status="pending_review"
    )
    result = actions.run_analysis(_invoice_for(vendor))
    assert any(
        finding["code"] == "VENDOR_ON_HOLD" for finding in result["findings"]
    )


def test_second_pending_bank_change_rejected(clerk, vendor):
    url = "/api/vendors/V001/bank-changes/"
    first = _client(clerk).post(url, {"bank_account": "9999999999999933"}, format="json")
    assert first.status_code == 201

    second = _client(clerk).post(url, {"bank_account": "8888888888888844"}, format="json")

    assert second.status_code == 409
    assert second.data["error"]["code"] == "INVALID_STATE_TRANSITION"


def test_invalid_bank_account_rejected(clerk, vendor):
    response = _client(clerk).post(
        "/api/vendors/V001/bank-changes/", {"bank_account": "abc"}, format="json"
    )
    assert response.status_code == 400
    assert response.data["error"]["code"] == "VALIDATION_ERROR"


def test_non_dict_bank_change_body_rejected(clerk, vendor):
    response = _client(clerk).post(
        "/api/vendors/V001/bank-changes/", ["nope"], format="json"
    )
    assert response.status_code == 400
    assert response.data["error"]["code"] == "VALIDATION_ERROR"


def test_patch_blank_legal_name_rejected(finance, vendor):
    response = _client(finance).patch(
        "/api/vendors/V001/", {"legal_name": ""}, format="json"
    )
    assert response.status_code == 400
    assert response.data["error"]["code"] == "VALIDATION_ERROR"


def test_patch_bad_payment_terms_rejected(finance, vendor):
    response = _client(finance).patch(
        "/api/vendors/V001/", {"payment_terms_days": ""}, format="json"
    )
    assert response.status_code == 400
    assert response.data["error"]["code"] == "VALIDATION_ERROR"


def test_patch_unknown_field_rejected(finance, vendor):
    response = _client(finance).patch(
        "/api/vendors/V001/", {"statuss": "active"}, format="json"
    )
    assert response.status_code == 400
    assert response.data["error"]["code"] == "VALIDATION_ERROR"


def test_hold_pending_review_is_invalid(finance):
    Vendor.objects.create(
        vendor_id="V052", legal_name="Pending Co", status="pending_review"
    )
    response = _client(finance).post("/api/vendors/V052/hold/")
    assert response.status_code == 409
    assert response.data["error"]["code"] == "INVALID_STATE_TRANSITION"


def test_on_leave_user_cannot_write(clerk):
    finance = _user("U098", User.Role.FINANCE_MANAGER)
    finance.status = User.Status.ON_LEAVE
    finance.save(update_fields=["status"])
    vendor = Vendor.objects.create(
        vendor_id="V053", legal_name="Pending Co", status="pending_review"
    )

    assert (
        _client(finance).post(f"/api/vendors/{vendor.vendor_id}/approve/").status_code
        == 403
    )
    # Read endpoints remain available.
    assert _client(finance).get("/api/vendors/").status_code == 200


def test_rejected_bank_change_is_not_a_fraud_signal():
    findings = detect_bank_change_risk(
        {"vendor_id": "V001", "invoice_date": "2026-01-20"},
        [
            {
                "change_id": "BC-REJ",
                "vendor_id": "V001",
                "changed_at": "2026-01-14",
                "verified_by_callback": "no",
                "status": "REJECTED",
            }
        ],
    )
    assert findings == []


def test_loader_normalizes_vendor_status(tmp_path):
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "vendors.csv").write_text(
        "vendor_id,legal_name,status\n"
        "V900,Acme,Active\n"
        "V901,Beta, on-hold \n"
    )

    from apps.invoices.loader import Loader

    Loader(tmp_path).load_vendors()

    assert Vendor.objects.get(vendor_id="V900").status == "active"
    assert Vendor.objects.get(vendor_id="V901").status == "on_hold"
