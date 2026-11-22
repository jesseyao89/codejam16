"""Approval decision tests (contract §7)."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.accounts.models import Department
from apps.approvals.models import ApprovalStep
from apps.audit.models import AuditEvent
from apps.invoices.models import Invoice

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


def _invoice(**overrides):
    defaults = {
        "invoice_id": "AP-00001",
        "status": Invoice.Status.PENDING_APPROVAL,
        "total": "105.00",
    }
    defaults.update(overrides)
    return Invoice.objects.create(**defaults)


def _step(invoice, step_no, approver, role="APPROVER", action=""):
    return ApprovalStep.objects.create(
        approval_id=f"APR-{step_no:05d}",
        invoice=invoice,
        step_no=step_no,
        approver=approver,
        approver_role=role,
        action=action,
    )


@pytest.fixture
def department(db):
    return Department.objects.create(department_id="D01", name="Operations")


@pytest.fixture
def requester(db):
    return _user("U013", User.Role.EMPLOYEE)


@pytest.fixture
def approver(db, department):
    user = _user("U007", User.Role.APPROVER, department=department)
    department.manager = user
    department.save(update_fields=["manager"])
    return user


@pytest.fixture
def finance(db):
    return _user("U003", User.Role.FINANCE_MANAGER)


@pytest.fixture
def clerk(db):
    return _user("U004", User.Role.AP_CLERK)


def test_approve_current_step_keeps_invoice_pending(requester, approver, finance, department):
    invoice = _invoice(requester=requester, department=department)
    step1 = _step(invoice, 1, approver)
    _step(invoice, 2, finance, "FINANCE_MANAGER")

    response = _client(approver).post(
        f"/api/approvals/{step1.approval_id}/approve/", {"comment": "ok"}, format="json"
    )

    assert response.status_code == 200
    assert response.data["status"] == "PENDING_APPROVAL"
    step1.refresh_from_db()
    assert step1.action == "approved"
    assert step1.acted_at is not None
    assert AuditEvent.objects.filter(
        action="APPROVAL_APPROVED", entity_id=invoice.invoice_id
    ).exists()


def test_approve_last_step_marks_invoice_approved(requester, approver, department):
    invoice = _invoice(requester=requester, department=department)
    step1 = _step(invoice, 1, approver)

    response = _client(approver).post(f"/api/approvals/{step1.approval_id}/approve/")

    assert response.status_code == 200
    assert response.data["status"] == "APPROVED"


def test_approve_non_current_step_is_invalid(requester, approver, finance, department):
    invoice = _invoice(requester=requester, department=department)
    _step(invoice, 1, approver)
    step2 = _step(invoice, 2, finance, "FINANCE_MANAGER")

    response = _client(finance).post(f"/api/approvals/{step2.approval_id}/approve/")

    assert response.status_code == 409
    assert response.data["error"]["code"] == "INVALID_STATE_TRANSITION"


def test_wrong_user_cannot_approve(requester, approver, department):
    other = _user("U009", User.Role.FINANCE_MANAGER)
    invoice = _invoice(requester=requester, department=department)
    step1 = _step(invoice, 1, approver)

    response = _client(other).post(f"/api/approvals/{step1.approval_id}/approve/")

    assert response.status_code == 403
    assert response.data["error"]["code"] == "PERMISSION_DENIED"


def test_requester_cannot_approve_own_invoice(approver, department):
    invoice = _invoice(requester=approver, department=department)
    step1 = _step(invoice, 1, approver)

    response = _client(approver).post(f"/api/approvals/{step1.approval_id}/approve/")

    assert response.status_code == 409
    assert response.data["error"]["code"] == "SELF_APPROVAL_BLOCKED"


def test_reject_returns_invoice_to_review(requester, approver, department):
    invoice = _invoice(requester=requester, department=department)
    step1 = _step(invoice, 1, approver)

    response = _client(approver).post(
        f"/api/approvals/{step1.approval_id}/reject/", {"comment": "no"}, format="json"
    )

    assert response.status_code == 200
    assert response.data["status"] == "REVIEW"
    step1.refresh_from_db()
    assert step1.action == "rejected"
    assert AuditEvent.objects.filter(
        action="APPROVAL_REJECTED", entity_id=invoice.invoice_id
    ).exists()


def test_act_on_non_pending_invoice_is_invalid(requester, approver, department):
    invoice = _invoice(
        requester=requester, department=department, status=Invoice.Status.DRAFT
    )
    step1 = _step(invoice, 1, approver)

    response = _client(approver).post(f"/api/approvals/{step1.approval_id}/approve/")

    assert response.status_code == 409
    assert response.data["error"]["code"] == "INVALID_STATE_TRANSITION"


def test_delegate_can_act_when_principal_on_leave(requester, approver, department):
    delegate = _user("U008", User.Role.APPROVER, department=department)
    approver.status = User.Status.ON_LEAVE
    approver.delegate = delegate
    approver.save(update_fields=["status", "delegate"])

    invoice = _invoice(requester=requester, department=department)
    step1 = _step(invoice, 1, approver)

    response = _client(delegate).post(f"/api/approvals/{step1.approval_id}/approve/")

    assert response.status_code == 200
    step1.refresh_from_db()
    assert step1.action == "approved"
    assert step1.delegated_for_id == approver.id

    event = AuditEvent.objects.get(
        action="APPROVAL_APPROVED", entity_id=invoice.invoice_id
    )
    assert event.evidence["on_behalf_of"] == approver.user_id


def test_mine_filter_returns_only_my_steps(requester, approver, finance, department):
    invoice = _invoice(requester=requester, department=department)
    step1 = _step(invoice, 1, approver)
    _step(invoice, 2, finance, "FINANCE_MANAGER")

    response = _client(approver).get("/api/approvals/?mine=true")

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["id"] == step1.approval_id


def test_resubmit_clears_pending_but_keeps_history(requester, approver, finance, clerk, department):
    invoice = _invoice(
        requester=requester, department=department, status=Invoice.Status.REVIEW
    )
    rejected = _step(invoice, 1, approver, action="rejected")
    pending = _step(invoice, 2, finance, "FINANCE_MANAGER", action="")

    response = _client(clerk).post(f"/api/invoices/{invoice.invoice_id}/submit/")

    assert response.status_code == 200
    assert response.data["status"] == "PENDING_APPROVAL"
    assert not ApprovalStep.objects.filter(approval_id=pending.approval_id).exists()
    assert ApprovalStep.objects.filter(approval_id=rejected.approval_id).exists()
    new_steps = ApprovalStep.objects.filter(invoice=invoice, action="")
    assert new_steps.exists()
    assert all(step.step_no > rejected.step_no for step in new_steps)
