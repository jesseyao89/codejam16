"""Delegation CRUD and approval-acting tests (contract §7.3)."""

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Delegation, Department
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


@pytest.fixture
def department(db):
    return Department.objects.create(department_id="D01", name="Operations")


@pytest.fixture
def principal(db, department):
    user = _user("U007", User.Role.APPROVER, department=department)
    department.manager = user
    department.save(update_fields=["manager"])
    return user


@pytest.fixture
def delegate(db):
    return _user("U008", User.Role.APPROVER)


@pytest.fixture
def controller(db):
    return _user("U001", User.Role.CONTROLLER)


@pytest.fixture
def auditor(db):
    return _user("U006", User.Role.AUDITOR)


@pytest.fixture
def employee(db):
    return _user("U013", User.Role.EMPLOYEE)


@pytest.fixture
def clerk(db):
    return _user("U004", User.Role.AP_CLERK)


def test_principal_creates_and_ends_delegation(principal, delegate):
    response = _client(principal).post(
        "/api/delegations/", {"delegate_id": "U008"}, format="json"
    )

    assert response.status_code == 201
    assert response.data["principal_id"] == "U007"
    assert response.data["delegate_id"] == "U008"
    assert response.data["active"] is True
    assert AuditEvent.objects.filter(action="DELEGATION_CREATED").exists()

    delegation_id = response.data["id"]
    listed = _client(principal).get("/api/delegations/")
    assert listed.status_code == 200
    assert listed.data["count"] == 1

    ended = _client(principal).delete(f"/api/delegations/{delegation_id}/")
    assert ended.status_code == 204
    delegation = Delegation.objects.get(pk=delegation_id)
    assert delegation.ends_at is not None
    assert delegation.is_active() is False
    assert AuditEvent.objects.filter(action="DELEGATION_ENDED").exists()


def test_controller_can_create_for_another_user(controller, principal, delegate):
    response = _client(controller).post(
        "/api/delegations/",
        {"principal_id": "U007", "delegate_id": "U008"},
        format="json",
    )
    assert response.status_code == 201
    assert response.data["principal_id"] == "U007"


def test_non_controller_cannot_delegate_for_another_user(principal, delegate):
    response = _client(principal).post(
        "/api/delegations/",
        {"principal_id": "U009", "delegate_id": "U008"},
        format="json",
    )
    assert response.status_code == 403


def test_employee_cannot_create_delegation(employee, delegate):
    response = _client(employee).post(
        "/api/delegations/", {"delegate_id": "U008"}, format="json"
    )
    assert response.status_code == 403


def test_delegate_must_be_approver_capable(principal, employee):
    response = _client(principal).post(
        "/api/delegations/", {"delegate_id": "U013"}, format="json"
    )
    assert response.status_code == 400


def test_overlapping_delegation_rejected(principal, delegate):
    start = timezone.now()
    first = _client(principal).post(
        "/api/delegations/",
        {
            "delegate_id": "U008",
            "starts_at": start.isoformat(),
            "ends_at": (start + timedelta(days=2)).isoformat(),
        },
        format="json",
    )
    assert first.status_code == 201

    second = _client(principal).post(
        "/api/delegations/",
        {
            "delegate_id": "U008",
            "starts_at": (start + timedelta(days=1)).isoformat(),
            "ends_at": (start + timedelta(days=3)).isoformat(),
        },
        format="json",
    )
    assert second.status_code == 400


def test_end_before_start_rejected(principal, delegate):
    start = timezone.now()
    response = _client(principal).post(
        "/api/delegations/",
        {
            "delegate_id": "U008",
            "starts_at": start.isoformat(),
            "ends_at": (start - timedelta(hours=1)).isoformat(),
        },
        format="json",
    )
    assert response.status_code == 400


def test_auditor_can_read_but_not_write(auditor, principal, delegate):
    Delegation.objects.create(principal=principal, delegate=delegate)
    assert _client(auditor).get("/api/delegations/").status_code == 200
    response = _client(auditor).post(
        "/api/delegations/", {"delegate_id": "U008"}, format="json"
    )
    assert response.status_code == 403


def _pending_step(principal, clerk, department):
    invoice = Invoice.objects.create(
        invoice_id="AP-00001",
        status=Invoice.Status.PENDING_APPROVAL,
        requester=clerk,
        department=department,
        total="105.00",
    )
    return ApprovalStep.objects.create(
        approval_id="APR-00001",
        invoice=invoice,
        step_no=1,
        approver=principal,
        approver_role="APPROVER",
        action="",
    )


def test_delegate_can_approve_principal_step(
    principal, delegate, clerk, department
):
    Delegation.objects.create(principal=principal, delegate=delegate)
    step = _pending_step(principal, clerk, department)

    listed = _client(delegate).get("/api/approvals/?mine=true")
    assert listed.status_code == 200
    assert any(row["id"] == step.approval_id for row in listed.data["results"])

    response = _client(delegate).post(
        f"/api/approvals/{step.approval_id}/approve/", {}, format="json"
    )

    assert response.status_code == 200
    step.refresh_from_db()
    assert step.action == "approved"
    assert step.delegated_for_id == principal.id
    assert Invoice.objects.get(invoice_id="AP-00001").status == "APPROVED"


def test_delegate_cannot_act_after_delegation_ends(
    principal, delegate, clerk, department
):
    delegation = Delegation.objects.create(
        principal=principal, delegate=delegate
    )
    step = _pending_step(principal, clerk, department)
    delegation.ends_at = timezone.now() - timedelta(minutes=1)
    delegation.save(update_fields=["ends_at"])

    response = _client(delegate).post(
        f"/api/approvals/{step.approval_id}/approve/", {}, format="json"
    )
    assert response.status_code in (403, 404)


def test_legacy_on_leave_delegate_still_works(
    principal, delegate, clerk, department
):
    principal.status = User.Status.ON_LEAVE
    principal.delegate = delegate
    principal.save(update_fields=["status", "delegate"])
    step = _pending_step(principal, clerk, department)

    response = _client(delegate).post(
        f"/api/approvals/{step.approval_id}/approve/", {}, format="json"
    )
    assert response.status_code == 200
    step.refresh_from_db()
    assert step.delegated_for_id == principal.id


def test_ended_proper_delegation_overrides_legacy_pair(
    principal, delegate, clerk, department
):
    principal.status = User.Status.ON_LEAVE
    principal.delegate = delegate
    principal.save(update_fields=["status", "delegate"])
    Delegation.objects.create(
        principal=principal,
        delegate=delegate,
        starts_at=timezone.now() - timedelta(days=2),
        ends_at=timezone.now() - timedelta(days=1),
    )
    step = _pending_step(principal, clerk, department)

    response = _client(delegate).post(
        f"/api/approvals/{step.approval_id}/approve/", {}, format="json"
    )
    assert response.status_code in (403, 404)
