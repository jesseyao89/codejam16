"""Audit trail tests (contract §9)."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.accounts.models import Department
from apps.approvals.models import ApprovalStep
from apps.audit.models import AuditEvent
from apps.invoices.models import GLAccount, Invoice, InvoiceLine
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
def controller(db):
    return _user("U001", User.Role.CONTROLLER)


@pytest.fixture
def auditor(db):
    return _user("U006", User.Role.AUDITOR)


@pytest.fixture
def clerk(db):
    return _user("U004", User.Role.AP_CLERK)


@pytest.fixture
def invoice(db):
    return Invoice.objects.create(
        invoice_id="AP-00001", status=Invoice.Status.REVIEW, total="105.00"
    )


def test_audit_list_requires_controller_or_auditor(clerk, controller):
    assert _client(clerk).get("/api/audit/").status_code == 403
    assert _client(controller).get("/api/audit/").status_code == 200


def test_audit_list_filters(controller, clerk):
    AuditEvent.objects.create(
        actor=controller,
        action="INVOICE_UPDATED",
        entity_type="INVOICE",
        entity_id="AP-00001",
    )
    AuditEvent.objects.create(
        actor=clerk,
        action="PAYMENT_RELEASED",
        entity_type="PAYMENT",
        entity_id="PAY-00001",
    )

    response = _client(controller).get("/api/audit/?action=PAYMENT_RELEASED")

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["entity_id"] == "PAY-00001"

    by_actor = _client(controller).get("/api/audit/?actor_id=U004")
    assert by_actor.data["count"] == 1

    by_entity = _client(controller).get("/api/audit/?entity_type=INVOICE")
    assert by_entity.data["count"] == 1


def test_audit_export_is_csv(controller):
    AuditEvent.objects.create(
        actor=controller,
        action="INVOICE_UPDATED",
        entity_type="INVOICE",
        entity_id="AP-00001",
    )

    response = _client(controller).get("/api/audit/export/")

    assert response.status_code == 200
    assert "text/csv" in response["Content-Type"]
    body = response.content.decode()
    assert body.startswith("id,timestamp,actor_id,actor_name")
    assert "INVOICE_UPDATED" in body


def test_invoice_trace_composes_chain(controller, clerk, invoice):
    ApprovalStep.objects.create(
        approval_id="APR-1",
        invoice=invoice,
        step_no=1,
        approver=controller,
        approver_role="APPROVER",
        action="approved",
    )
    Payment.objects.create(
        payment_id="PAY-1",
        invoice=invoice,
        status="settled",
        amount="105.00",
        currency="CAD",
        amount_cad="105.00",
    )
    AuditEvent.objects.create(
        actor=clerk,
        action="INVOICE_UPDATED",
        entity_type="INVOICE",
        entity_id=invoice.invoice_id,
        evidence={
            "coding_changes": [
                {
                    "line_no": 1,
                    "before": {"gl_account": None, "department_id": None},
                    "after": {"gl_account": "5010", "department_id": "D01"},
                }
            ]
        },
    )
    AuditEvent.objects.create(
        actor=controller,
        action="PAYMENT_RELEASED",
        entity_type="PAYMENT",
        entity_id="PAY-1",
    )

    response = _client(controller).get(f"/api/invoices/{invoice.invoice_id}/audit/")

    assert response.status_code == 200
    data = response.data
    assert data["invoice_id"] == invoice.invoice_id
    assert len(data["approvals"]) == 1
    assert len(data["payments"]) == 1
    assert len(data["events"]) == 2
    assert data["coding_history"][0]["gl_account"] == "5010"
    assert data["coding_history"][0]["source"] == "MANUAL"


def test_invoice_trace_requires_audit_role(clerk, invoice):
    response = _client(clerk).get(f"/api/invoices/{invoice.invoice_id}/audit/")
    assert response.status_code == 403


def test_patch_records_coding_changes(clerk):
    Department.objects.create(department_id="D01", name="Operations")
    GLAccount.objects.create(account_number="5010", name="Freight", account_type="expense")
    invoice = Invoice.objects.create(
        invoice_id="AP-00001", status=Invoice.Status.DRAFT, requester=clerk
    )
    InvoiceLine.objects.create(invoice=invoice, line_no=1, description="x")

    response = _client(clerk).patch(
        f"/api/invoices/{invoice.invoice_id}/",
        {"lines": [{"line_no": 1, "gl_account": "5010", "department_id": "D01"}]},
        format="json",
    )

    assert response.status_code == 200
    event = AuditEvent.objects.get(
        action="INVOICE_UPDATED", entity_id=invoice.invoice_id
    )
    changes = event.evidence["coding_changes"]
    assert changes[0]["line_no"] == 1
    assert changes[0]["after"]["gl_account"] == "5010"


def test_dashboard_recent_activity(controller, invoice):
    AuditEvent.objects.create(
        actor=controller,
        action="INVOICE_SUBMITTED",
        entity_type="INVOICE",
        entity_id=invoice.invoice_id,
    )

    response = _client(controller).get("/api/dashboard/")

    assert response.status_code == 200
    assert len(response.data["recent_activity"]) == 1
    assert response.data["recent_activity"][0]["action"] == "INVOICE_SUBMITTED"
