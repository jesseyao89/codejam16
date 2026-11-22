"""Payment tests (contract §8)."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.accounts.models import Department
from apps.approvals.models import ApprovalStep
from apps.invoices.models import Invoice
from apps.payments import services
from apps.payments.models import Payment
from apps.vendors.models import Vendor

User = get_user_model()

pytestmark = pytest.mark.django_db


def _user(uid, role, **kwargs):
    return User.objects.create_user(
        username=uid,
        user_id=uid,
        password="demo1234",
        role=role,
        status=User.Status.ACTIVE,
        **kwargs,
    )


def _client(user):
    api = APIClient()
    api.force_authenticate(user=user)
    return api


@pytest.fixture
def clerk(db):
    return _user("U004", User.Role.AP_CLERK)


@pytest.fixture
def finance(db):
    return _user("U003", User.Role.FINANCE_MANAGER)


@pytest.fixture
def controller(db):
    return _user("U001", User.Role.CONTROLLER)


@pytest.fixture
def vendor(db):
    return Vendor.objects.create(
        vendor_id="V015",
        legal_name="Polar Freight Lines Ltd.",
        status=Vendor.Status.ACTIVE,
        bank_account="1234567890124821",
        preferred_payment_method="EFT",
    )


@pytest.fixture
def invoice(db, vendor):
    return Invoice.objects.create(
        invoice_id="AP-00001",
        status=Invoice.Status.APPROVED,
        vendor=vendor,
        currency="CAD",
        total="105.00",
        total_cad="105.00",
    )


def test_prepare_creates_prepared_payment(clerk, invoice):
    response = _client(clerk).post(
        "/api/payments/prepare/", {"invoice_id": invoice.invoice_id}, format="json"
    )

    assert response.status_code == 201
    data = response.data
    assert data["status"] == "PREPARED"
    assert data["amount"] == "105.00"
    assert data["amount_cad"] == "105.00"
    assert data["prepared_by_id"] == "U004"
    assert data["bank_account_masked"] == "**** 4821"
    assert data["created_at"] is not None


def test_prepare_requires_approved_invoice(clerk, invoice):
    invoice.status = Invoice.Status.DRAFT
    invoice.save(update_fields=["status"])

    response = _client(clerk).post(
        "/api/payments/prepare/", {"invoice_id": invoice.invoice_id}, format="json"
    )

    assert response.status_code == 409
    assert response.data["error"]["code"] == "INVALID_STATE_TRANSITION"


def test_prepare_is_idempotent(clerk, invoice):
    first = _client(clerk).post(
        "/api/payments/prepare/", {"invoice_id": invoice.invoice_id}, format="json"
    )
    second = _client(clerk).post(
        "/api/payments/prepare/", {"invoice_id": invoice.invoice_id}, format="json"
    )

    assert first.data["id"] == second.data["id"]
    assert Payment.objects.filter(invoice=invoice).count() == 1


def test_finance_release_marks_paid(finance, clerk, invoice):
    payment = services.prepare_payment(invoice, clerk)

    response = _client(finance).post(f"/api/payments/{payment.payment_id}/release/")

    assert response.status_code == 200
    assert response.data["status"] == "PAID"
    assert response.data["released_by_id"] == "U003"
    assert response.data["paid_date"] is not None
    invoice.refresh_from_db()
    assert invoice.status == "PAID"


def test_finance_over_limit_is_blocked(finance, clerk, invoice):
    invoice.total = "150000.00"
    invoice.total_cad = "150000.00"
    invoice.save(update_fields=["total", "total_cad"])
    payment = services.prepare_payment(invoice, clerk)

    response = _client(finance).post(f"/api/payments/{payment.payment_id}/release/")

    assert response.status_code == 409
    assert response.data["error"]["code"] == "LIMIT_EXCEEDED"


def test_controller_can_release_any_amount(controller, clerk, invoice):
    invoice.total = "150000.00"
    invoice.total_cad = "150000.00"
    invoice.save(update_fields=["total", "total_cad"])
    payment = services.prepare_payment(invoice, clerk)

    response = _client(controller).post(
        f"/api/payments/{payment.payment_id}/release/"
    )

    assert response.status_code == 200
    assert response.data["status"] == "PAID"


def test_ap_clerk_cannot_release(clerk, invoice):
    payment = services.prepare_payment(invoice, clerk)

    response = _client(clerk).post(f"/api/payments/{payment.payment_id}/release/")

    assert response.status_code == 403
    assert response.data["error"]["code"] == "PERMISSION_DENIED"


def test_approver_of_invoice_cannot_release(finance, clerk, invoice):
    ApprovalStep.objects.create(
        approval_id="APR-DOD",
        invoice=invoice,
        step_no=1,
        approver=finance,
        approver_role="FINANCE_MANAGER",
        action="approved",
    )
    payment = services.prepare_payment(invoice, clerk)

    response = _client(finance).post(f"/api/payments/{payment.payment_id}/release/")

    assert response.status_code == 403
    assert response.data["error"]["code"] == "PERMISSION_DENIED"


def test_release_is_idempotent(finance, clerk, invoice):
    payment = services.prepare_payment(invoice, clerk)

    first = _client(finance).post(f"/api/payments/{payment.payment_id}/release/")
    second = _client(finance).post(f"/api/payments/{payment.payment_id}/release/")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.data["id"] == second.data["id"]
    assert Payment.objects.filter(invoice=invoice, status="PAID").count() == 1


def test_cancel_prepared_payment(clerk, invoice):
    payment = services.prepare_payment(invoice, clerk)

    response = _client(clerk).post(f"/api/payments/{payment.payment_id}/cancel/")

    assert response.status_code == 200
    assert response.data["status"] == "CANCELLED"


def test_cancel_paid_payment_is_invalid(finance, clerk, invoice):
    payment = services.prepare_payment(invoice, clerk)
    services.release_payment(payment, finance)

    response = _client(clerk).post(f"/api/payments/{payment.payment_id}/cancel/")

    assert response.status_code == 409
    assert response.data["error"]["code"] == "INVALID_STATE_TRANSITION"


def test_payment_list_scoped_to_visible_invoices(controller, clerk, finance, invoice):
    services.prepare_payment(invoice, clerk)

    response = _client(controller).get("/api/payments/")

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["invoice_id"] == invoice.invoice_id


def test_payment_status_normalized_for_historical_rows(controller, invoice):
    for payment_id, status in (
        ("PAY-LEGACY-1", "settled"),
        ("PAY-LEGACY-2", "scheduled"),
        ("PAY-LEGACY-3", "outstanding"),
    ):
        Payment.objects.create(
            payment_id=payment_id,
            invoice=invoice,
            status=status,
            amount="105.00",
            currency="CAD",
            amount_cad="105.00",
        )

    response = _client(controller).get("/api/payments/")

    statuses = {row["id"]: row["status"] for row in response.data["results"]}
    assert statuses["PAY-LEGACY-1"] == "PAID"
    assert statuses["PAY-LEGACY-2"] == "SCHEDULED"
    assert statuses["PAY-LEGACY-3"] == "SCHEDULED"


def test_release_refuses_when_invoice_already_paid(finance, invoice):
    invoice.status = Invoice.Status.PAID
    invoice.save(update_fields=["status"])
    payment = Payment.objects.create(
        payment_id="PAY-HIST",
        invoice=invoice,
        status="scheduled",
        amount="105.00",
        currency="CAD",
        amount_cad="105.00",
    )

    response = _client(finance).post(f"/api/payments/{payment.payment_id}/release/")

    assert response.status_code == 409
    assert response.data["error"]["code"] == "INVALID_STATE_TRANSITION"


def test_payment_status_filter_accepts_canonical_values(controller, invoice):
    for payment_id, status in (
        ("P-1", "settled"),
        ("P-2", "scheduled"),
        ("P-3", "outstanding"),
        ("P-4", "PAID"),
        ("P-5", "PREPARED"),
    ):
        Payment.objects.create(
            payment_id=payment_id,
            invoice=invoice,
            status=status,
            amount="1.00",
            currency="CAD",
            amount_cad="1.00",
        )

    def ids(status):
        response = _client(controller).get(f"/api/payments/?status={status}")
        return {row["id"] for row in response.data["results"]}

    assert ids("PAID") == {"P-1", "P-4"}
    assert ids("SCHEDULED") == {"P-2", "P-3"}
    assert ids("settled") == {"P-1"}
