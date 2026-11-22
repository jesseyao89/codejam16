"""Approval policy CRUD and bounded policy engine (contract §7.2)."""

from io import StringIO
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.accounts.models import Department
from apps.approvals import policy as policy_engine
from apps.approvals.models import ApprovalPolicy
from apps.audit.models import AuditEvent
from apps.invoices.models import Invoice
from apps.vendors.models import Vendor

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


def _policy_payload(**overrides):
    payload = {
        "name": "Test policy",
        "priority": 10,
        "active": True,
        "conditions": {
            "match": "all",
            "rules": [
                {"field": "invoice.total_cad", "op": "gt", "value": "1000"}
            ],
        },
        "steps": [{"step_no": 1, "role": "APPROVER", "approver_id": None}],
    }
    payload.update(overrides)
    return payload


def _invoice(amount, vendor, department, requester):
    return Invoice.objects.create(
        invoice_id=f"AP-{uuid4().hex[:8].upper()}",
        vendor=vendor,
        department=department,
        requester=requester,
        status=Invoice.Status.DRAFT,
        currency="CAD",
        subtotal=amount,
        gst_hst_amount="0.00",
        pst_qst_amount="0.00",
        total=amount,
        total_cad=amount,
    )


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
def finance(db):
    return _user("U003", User.Role.FINANCE_MANAGER)


@pytest.fixture
def approver(db):
    return _user("U007", User.Role.APPROVER)


@pytest.fixture
def department(db, approver):
    dep = Department.objects.create(department_id="D01", name="Operations")
    dep.manager = approver
    dep.save(update_fields=["manager"])
    approver.department = dep
    approver.save(update_fields=["department"])
    return dep


@pytest.fixture
def vendor(db):
    return Vendor.objects.create(
        vendor_id="V001",
        legal_name="Polar Freight Lines Ltd.",
        category="Freight & Carriers",
        status=Vendor.Status.ACTIVE,
    )


# --- Validation -------------------------------------------------------------


@pytest.mark.parametrize(
    "conditions",
    [
        {"match": "all", "rules": [{"field": "invoice.nope", "op": "eq", "value": "x"}]},
        {
            "match": "all",
            "rules": [
                {"field": "invoice.total_cad", "op": "contains", "value": "x"}
            ],
        },
        {
            "match": "all",
            "rules": [{"field": "invoice.total_cad", "op": "gt", "value": "abc"}],
        },
        {
            "match": "all",
            "rules": [
                {"field": "invoice.total_cad", "op": "eq", "value": {"nested": 1}}
            ],
        },
        {
            "match": "all",
            "rules": [
                {"field": "vendor.status", "op": "is_null", "value": "x"}
            ],
        },
        {
            "match": "all",
            "rules": [
                {"field": "vendor.status", "op": "in", "value": "pending_review"}
            ],
        },
    ],
)
def test_policy_condition_validation_rejects_bad_input(
    controller, conditions
):
    response = _client(controller).post(
        "/api/policies/",
        _policy_payload(conditions=conditions),
        format="json",
    )
    assert response.status_code == 400
    assert response.data["error"]["code"] == "VALIDATION_ERROR"


def test_policy_rejects_bad_steps(controller):
    for steps in (
        [],
        [{"role": "CFO"}],
        [{"role": "APPROVER", "approver_id": "U999"}],
    ):
        response = _client(controller).post(
            "/api/policies/",
            _policy_payload(steps=steps),
            format="json",
        )
        assert response.status_code == 400


def test_policy_rejects_unknown_top_level_fields(controller):
    payload = _policy_payload()
    payload["bogus"] = 1
    response = _client(controller).post("/api/policies/", payload, format="json")
    assert response.status_code == 400


# --- CRUD -------------------------------------------------------------------


def test_policy_crud_and_audit(controller, auditor, clerk):
    created = _client(controller).post(
        "/api/policies/", _policy_payload(), format="json"
    )
    assert created.status_code == 201
    assert created.data["id"].startswith("POL-")
    assert created.data["active"] is True
    rule_id = created.data["id"]
    assert AuditEvent.objects.filter(action="POLICY_CREATED").exists()

    assert _client(auditor).get("/api/policies/").status_code == 200
    assert _client(clerk).get("/api/policies/").status_code == 403

    patched = _client(controller).patch(
        f"/api/policies/{rule_id}/", {"name": "Renamed"}, format="json"
    )
    assert patched.status_code == 200
    assert patched.data["name"] == "Renamed"
    assert AuditEvent.objects.filter(action="POLICY_UPDATED").exists()

    deleted = _client(controller).delete(f"/api/policies/{rule_id}/")
    assert deleted.status_code == 204
    assert not ApprovalPolicy.objects.get(rule_id=rule_id).active
    assert AuditEvent.objects.filter(action="POLICY_ARCHIVED").exists()


def test_policy_writes_controller_only(controller, auditor, clerk):
    assert (
        _client(auditor)
        .post("/api/policies/", _policy_payload(), format="json")
        .status_code
        == 403
    )
    created = _client(controller).post(
        "/api/policies/", _policy_payload(), format="json"
    )
    rule_id = created.data["id"]
    assert (
        _client(auditor)
        .patch(f"/api/policies/{rule_id}/", {"name": "x"}, format="json")
        .status_code
        == 403
    )
    assert _client(clerk).delete(f"/api/policies/{rule_id}/").status_code == 403


# --- Engine -----------------------------------------------------------------


def _seed():
    call_command("seed_policies", stdout=StringIO())


def _roles(steps):
    return [step.approver_role for step in steps]


def test_seed_policies_is_idempotent():
    _seed()
    assert ApprovalPolicy.objects.count() == 6
    call_command("seed_policies", stdout=StringIO())
    assert ApprovalPolicy.objects.count() == 6


def test_no_policies_uses_baseline(approver, finance, clerk, department, vendor):
    approver.approval_limit_cad = "10000.00"
    approver.save(update_fields=["approval_limit_cad"])
    invoice = _invoice("20000.00", vendor, department, clerk)
    assert _roles(policy_engine.build_chain(invoice)) == [
        "APPROVER",
        "FINANCE_MANAGER",
    ]


def test_seeded_amount_policies(approver, finance, clerk, department, vendor):
    _seed()

    small = _invoice("5000.00", vendor, department, clerk)
    assert _roles(policy_engine.build_chain(small)) == ["APPROVER"]

    medium = _invoice("20000.00", vendor, department, clerk)
    assert _roles(policy_engine.build_chain(medium)) == [
        "APPROVER",
        "FINANCE_MANAGER",
    ]

    large = _invoice("60000.00", vendor, department, clerk)
    assert _roles(policy_engine.build_chain(large)) == [
        "APPROVER",
        "FINANCE_MANAGER",
        "CONTROLLER",
    ]


def test_pending_vendor_adds_finance(approver, finance, clerk, department, vendor):
    _seed()
    vendor.status = Vendor.Status.PENDING_REVIEW
    vendor.save(update_fields=["status"])

    invoice = _invoice("5000.00", vendor, department, clerk)
    assert _roles(policy_engine.build_chain(invoice)) == [
        "APPROVER",
        "FINANCE_MANAGER",
    ]


def test_legal_vendor_adds_finance(approver, finance, clerk, department, vendor):
    _seed()
    vendor.category = "Legal"
    vendor.save(update_fields=["category"])

    invoice = _invoice("5000.00", vendor, department, clerk)
    assert _roles(policy_engine.build_chain(invoice)) == [
        "APPROVER",
        "FINANCE_MANAGER",
    ]


def test_string_comparison_is_case_insensitive(
    approver, finance, clerk, department, vendor
):
    _seed()
    vendor.category = "legal"
    vendor.save(update_fields=["category"])

    invoice = _invoice("5000.00", vendor, department, clerk)
    assert "FINANCE_MANAGER" in _roles(policy_engine.build_chain(invoice))


def test_null_semantics(approver, finance, clerk, department):
    invoice = _invoice("5000.00", None, department, clerk)
    context = policy_engine.build_context(invoice)

    # A null field must not match `eq`; only `is_null` sees it.
    eq_legal = ApprovalPolicy(
        conditions={
            "match": "all",
            "rules": [{"field": "vendor.category", "op": "eq", "value": "Legal"}],
        },
        steps=[{"step_no": 1, "role": "FINANCE_MANAGER", "approver_id": None}],
    )
    assert policy_engine.condition_matches(eq_legal, context) is False

    is_null = ApprovalPolicy(
        conditions={
            "match": "all",
            "rules": [{"field": "vendor.category", "op": "is_null"}],
        },
        steps=[{"step_no": 1, "role": "FINANCE_MANAGER", "approver_id": None}],
    )
    assert policy_engine.condition_matches(is_null, context) is True

    # An unknown vendor still routes through finance.
    assert "FINANCE_MANAGER" in _roles(policy_engine.build_chain(invoice))


def test_manager_limit_invariant(approver, finance, clerk, department, vendor):
    approver.approval_limit_cad = "10000.00"
    approver.save(update_fields=["approval_limit_cad"])
    ApprovalPolicy.objects.create(
        rule_id="POL-ONLY-APPROVER",
        name="Approver only",
        priority=10,
        active=True,
        conditions={},
        steps=[{"step_no": 1, "role": "APPROVER", "approver_id": None}],
    )

    invoice = _invoice("20000.00", vendor, department, clerk)
    assert _roles(policy_engine.build_chain(invoice)) == [
        "APPROVER",
        "FINANCE_MANAGER",
    ]


def test_self_approval_escalates(department, vendor):
    director = _user("U050", User.Role.APPROVER)
    manager = _user("U051", User.Role.APPROVER, )
    manager.manager = director
    manager.department = department
    manager.save(update_fields=["manager", "department"])
    department.manager = manager
    department.save(update_fields=["manager"])

    _seed()
    invoice = _invoice("5000.00", vendor, department, manager)
    steps = policy_engine.build_chain(invoice)
    assert steps[0].approver == director


def test_submit_uses_policy_chain(clerk, approver, finance, department, vendor):
    _seed()
    invoice = _invoice("20000.00", vendor, department, clerk)

    response = _client(clerk).post(f"/api/invoices/{invoice.invoice_id}/submit/")

    assert response.status_code == 200
    approvals = response.data["approvals"]
    assert [row["status"] for row in approvals] == ["PENDING", "PENDING"]
    assert [row["approver"]["role"] for row in approvals] == [
        "APPROVER",
        "FINANCE_MANAGER",
    ]
    assert any("Policy" in row["reason"] for row in approvals)


# --- Review fixes -----------------------------------------------------------


def _make_policy(rule_id, conditions, steps, priority=10, rule_type="approval"):
    return ApprovalPolicy.objects.create(
        rule_id=rule_id,
        name=rule_id,
        rule_type=rule_type,
        priority=priority,
        active=True,
        conditions=conditions,
        steps=steps,
    )


def test_department_condition_matches_dataset_id(
    approver, finance, clerk, department, vendor
):
    _make_policy(
        "POL-D01",
        {"match": "all", "rules": [{"field": "invoice.department_id", "op": "eq", "value": "D01"}]},
        [{"step_no": 1, "role": "FINANCE_MANAGER", "approver_id": None}],
    )
    _make_policy(
        "POL-D99",
        {"match": "all", "rules": [{"field": "invoice.department_id", "op": "eq", "value": "D99"}]},
        [{"step_no": 1, "role": "CONTROLLER", "approver_id": None}],
        priority=20,
    )

    invoice = _invoice("5000.00", vendor, department, clerk)
    roles = _roles(policy_engine.build_chain(invoice))
    assert "FINANCE_MANAGER" in roles
    assert "CONTROLLER" not in roles


def test_non_approval_rule_type_is_not_matched(approver, finance, clerk, department, vendor):
    _make_policy(
        "P09",
        {},
        [],
        rule_type="payment_release",
    )
    invoice = _invoice("5000.00", vendor, department, clerk)
    # Falls back to the baseline; the prose payment_release row is ignored.
    assert _roles(policy_engine.build_chain(invoice)) == ["APPROVER"]


def test_conditions_null_is_normalized(controller):
    payload = _policy_payload(conditions=None)
    response = _client(controller).post("/api/policies/", payload, format="json")
    assert response.status_code == 201
    assert response.data["conditions"] == {}


def test_non_object_body_rejected(controller):
    response = _client(controller).post("/api/policies/", [], format="json")
    assert response.status_code == 400
    assert response.data["error"]["code"] == "VALIDATION_ERROR"


def test_on_leave_controller_can_read_not_write(controller):
    controller.status = User.Status.ON_LEAVE
    controller.save(update_fields=["status"])

    assert _client(controller).get("/api/policies/").status_code == 200
    assert (
        _client(controller)
        .post("/api/policies/", _policy_payload(), format="json")
        .status_code
        == 403
    )


def test_policy_audit_includes_conditions_and_steps(controller):
    created = _client(controller).post(
        "/api/policies/", _policy_payload(), format="json"
    )
    assert created.status_code == 201

    event = AuditEvent.objects.filter(action="POLICY_CREATED").latest("timestamp")
    assert event.after["conditions"]["rules"]
    assert event.after["steps"]


def test_null_total_cad_requires_finance(approver, finance, clerk, department, vendor):
    _make_policy(
        "POL-APPROVER",
        {},
        [{"step_no": 1, "role": "APPROVER", "approver_id": None}],
    )
    invoice = _invoice("1000.00", vendor, department, clerk)
    invoice.currency = "USD"
    invoice.total_cad = None
    invoice.save(update_fields=["currency", "total_cad"])

    roles = _roles(policy_engine.build_chain(invoice))
    assert "FINANCE_MANAGER" in roles


def test_terminated_manager_escalates(approver, finance, clerk, department, vendor):
    director = _user("U060", User.Role.APPROVER)
    approver.status = User.Status.TERMINATED
    approver.is_active = False
    approver.manager = director
    approver.save(update_fields=["status", "is_active", "manager"])

    _make_policy(
        "POL-APPROVER",
        {},
        [{"step_no": 1, "role": "APPROVER", "approver_id": None}],
    )
    invoice = _invoice("5000.00", vendor, department, clerk)
    steps = policy_engine.build_chain(invoice)
    assert steps[0].approver == director


def test_approver_role_mismatch_rejected(controller, finance):
    response = _client(controller).post(
        "/api/policies/",
        _policy_payload(
            steps=[{"role": "APPROVER", "approver_id": finance.user_id}]
        ),
        format="json",
    )
    assert response.status_code == 400


def test_delete_is_audited_even_when_already_inactive(controller):
    created = _client(controller).post(
        "/api/policies/", _policy_payload(), format="json"
    )
    rule_id = created.data["id"]

    assert _client(controller).delete(f"/api/policies/{rule_id}/").status_code == 204
    assert _client(controller).delete(f"/api/policies/{rule_id}/").status_code == 204
    assert AuditEvent.objects.filter(action="POLICY_ARCHIVED").count() == 2


def test_active_policy_requires_steps(controller):
    ApprovalPolicy.objects.create(
        rule_id="P01",
        rule_type="approval",
        active=False,
        conditions={},
        steps=[],
    )
    response = _client(controller).patch(
        "/api/policies/P01/", {"active": True}, format="json"
    )
    assert response.status_code == 400


def test_empty_patch_rejected(controller):
    created = _client(controller).post(
        "/api/policies/", _policy_payload(), format="json"
    )
    rule_id = created.data["id"]
    response = _client(controller).patch(
        f"/api/policies/{rule_id}/", {}, format="json"
    )
    assert response.status_code == 400


def test_date_and_in_operators(approver, finance, clerk, department, vendor):
    vendor.onboarded_at = "2026-06-01"
    vendor.category = "Legal"
    vendor.save(update_fields=["onboarded_at", "category"])

    _make_policy(
        "POL-DATE",
        {"match": "all", "rules": [{"field": "vendor.onboarded_at", "op": "gte", "value": "2026-01-01"}]},
        [{"step_no": 1, "role": "FINANCE_MANAGER", "approver_id": None}],
    )
    _make_policy(
        "POL-IN",
        {"match": "all", "rules": [{"field": "vendor.category", "op": "in", "value": ["Legal", "Consulting"]}]},
        [{"step_no": 1, "role": "CONTROLLER", "approver_id": None}],
        priority=20,
    )

    invoice = _invoice("5000.00", vendor, department, clerk)
    roles = _roles(policy_engine.build_chain(invoice))
    assert "FINANCE_MANAGER" in roles
    assert "CONTROLLER" in roles


# --- Second review regressions ---------------------------------------------


def test_patch_without_conditions_preserves_them(controller):
    created = _client(controller).post(
        "/api/policies/", _policy_payload(), format="json"
    )
    rule_id = created.data["id"]
    conditions = created.data["conditions"]

    renamed = _client(controller).patch(
        f"/api/policies/{rule_id}/", {"name": "Renamed"}, format="json"
    )
    assert renamed.status_code == 200
    assert renamed.data["conditions"] == conditions

    deactivated = _client(controller).patch(
        f"/api/policies/{rule_id}/", {"active": False}, format="json"
    )
    assert deactivated.data["conditions"] == conditions

    reactivated = _client(controller).patch(
        f"/api/policies/{rule_id}/", {"active": True}, format="json"
    )
    assert reactivated.data["conditions"] == conditions


def test_patch_audit_records_conditions(controller):
    created = _client(controller).post(
        "/api/policies/", _policy_payload(), format="json"
    )
    rule_id = created.data["id"]
    before = created.data["conditions"]

    new_conditions = {"match": "all", "rules": []}
    response = _client(controller).patch(
        f"/api/policies/{rule_id}/",
        {"conditions": new_conditions},
        format="json",
    )
    assert response.status_code == 200

    event = AuditEvent.objects.filter(action="POLICY_UPDATED").latest("timestamp")
    assert event.before["conditions"] == before
    assert event.after["conditions"] == new_conditions


@pytest.mark.parametrize("conditions", [[], "", 0, False])
def test_falsy_non_object_conditions_rejected(controller, conditions):
    response = _client(controller).post(
        "/api/policies/",
        _policy_payload(conditions=conditions),
        format="json",
    )
    assert response.status_code == 400
    assert response.data["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_money_rejected(controller, value):
    conditions = {
        "match": "all",
        "rules": [{"field": "invoice.total_cad", "op": "gt", "value": value}],
    }
    response = _client(controller).post(
        "/api/policies/", _policy_payload(conditions=conditions), format="json"
    )
    assert response.status_code == 400


def test_malformed_rules_fail_closed(approver, clerk, department, vendor):
    _make_policy(
        "POL-BAD",
        {"match": "all", "rules": "not-a-list"},
        [{"step_no": 1, "role": "FINANCE_MANAGER", "approver_id": None}],
    )
    invoice = _invoice("5000.00", vendor, department, clerk)
    assert "FINANCE_MANAGER" not in _roles(policy_engine.build_chain(invoice))


def test_blank_rule_type_policy_executes(approver, clerk, department, vendor):
    _make_policy(
        "POL-BLANK",
        {},
        [{"step_no": 1, "role": "FINANCE_MANAGER", "approver_id": None}],
        rule_type="",
    )
    invoice = _invoice("5000.00", vendor, department, clerk)
    assert "FINANCE_MANAGER" in _roles(policy_engine.build_chain(invoice))


def test_requester_department_and_id_conditions(
    approver, finance, clerk, department, vendor
):
    clerk.department = department
    clerk.save(update_fields=["department"])

    _make_policy(
        "POL-REQ",
        {
            "match": "all",
            "rules": [
                {"field": "requester.department_id", "op": "eq", "value": "D01"},
                {"field": "invoice.requester_id", "op": "eq", "value": clerk.user_id},
            ],
        },
        [{"step_no": 1, "role": "FINANCE_MANAGER", "approver_id": None}],
    )
    invoice = _invoice("5000.00", vendor, department, clerk)
    assert "FINANCE_MANAGER" in _roles(policy_engine.build_chain(invoice))


def test_on_leave_manager_with_delegate_can_be_approved(
    approver, finance, clerk, department, vendor
):
    delegate = _user("U070", User.Role.APPROVER)
    approver.status = User.Status.ON_LEAVE
    approver.delegate = delegate
    approver.save(update_fields=["status", "delegate"])

    invoice = _invoice("5000.00", vendor, department, clerk)
    steps = policy_engine.build_chain(invoice)
    assert steps[0].approver == approver

    submitted = _client(clerk).post(f"/api/invoices/{invoice.invoice_id}/submit/")
    approval_id = submitted.data["approvals"][0]["id"]

    response = _client(delegate).post(
        f"/api/approvals/{approval_id}/approve/", {}, format="json"
    )
    assert response.status_code == 200
    assert response.data["status"] == "APPROVED"


def test_escalated_approver_outside_department_can_act(
    approver, finance, clerk, department, vendor
):
    other = Department.objects.create(department_id="D02", name="Field Ops")
    director = _user("U071", User.Role.APPROVER)
    director.department = other
    director.save(update_fields=["department"])

    approver.status = User.Status.ON_LEAVE
    approver.delegate = None
    approver.manager = director
    approver.save(update_fields=["status", "delegate", "manager"])

    invoice = _invoice("5000.00", vendor, department, clerk)
    steps = policy_engine.build_chain(invoice)
    assert steps[0].approver == director

    submitted = _client(clerk).post(f"/api/invoices/{invoice.invoice_id}/submit/")
    approval_id = submitted.data["approvals"][0]["id"]

    listed = _client(director).get("/api/approvals/?mine=true")
    assert listed.status_code == 200
    assert any(row["id"] == approval_id for row in listed.data["results"])

    response = _client(director).post(
        f"/api/approvals/{approval_id}/approve/", {}, format="json"
    )
    assert response.status_code == 200
    assert response.data["status"] == "APPROVED"


def test_escalation_skips_terminated_manager_chain(
    approver, finance, clerk, department, vendor
):
    middle = _user("U072", User.Role.APPROVER)
    director = _user("U073", User.Role.APPROVER)

    approver.status = User.Status.TERMINATED
    approver.is_active = False
    approver.manager = middle
    approver.save(update_fields=["status", "is_active", "manager"])

    middle.status = User.Status.TERMINATED
    middle.is_active = False
    middle.manager = director
    middle.save(update_fields=["status", "is_active", "manager"])

    invoice = _invoice("5000.00", vendor, department, clerk)
    assert policy_engine.build_chain(invoice)[0].approver == director


def test_non_active_vendor_always_needs_finance(
    approver, finance, clerk, department, vendor
):
    vendor.status = Vendor.Status.ON_HOLD
    vendor.save(update_fields=["status"])
    _make_policy(
        "POL-SMALL",
        {},
        [{"step_no": 1, "role": "APPROVER", "approver_id": None}],
    )
    invoice = _invoice("5000.00", vendor, department, clerk)
    assert _roles(policy_engine.build_chain(invoice)) == [
        "APPROVER",
        "FINANCE_MANAGER",
    ]


def test_finance_step_is_inserted_before_controller(
    approver, finance, clerk, department, vendor
):
    approver.approval_limit_cad = "1000.00"
    approver.save(update_fields=["approval_limit_cad"])

    _make_policy(
        "POL-AC",
        {},
        [
            {"step_no": 1, "role": "APPROVER", "approver_id": None},
            {"step_no": 2, "role": "CONTROLLER", "approver_id": None},
        ],
    )
    invoice = _invoice("5000.00", vendor, department, clerk)
    assert _roles(policy_engine.build_chain(invoice)) == [
        "APPROVER",
        "FINANCE_MANAGER",
        "CONTROLLER",
    ]


# --- Third review regressions -----------------------------------------------


def _prepare_on_leave(principal, delegate):
    principal.status = User.Status.ON_LEAVE
    principal.delegate = delegate
    principal.save(update_fields=["status", "delegate"])


def test_on_leave_principal_cannot_approve_own_step(
    approver, clerk, department, vendor
):
    delegate = _user("U080", User.Role.APPROVER)
    _prepare_on_leave(approver, delegate)

    invoice = _invoice("5000.00", vendor, department, clerk)
    submitted = _client(clerk).post(f"/api/invoices/{invoice.invoice_id}/submit/")
    approval_id = submitted.data["approvals"][0]["id"]

    denied = _client(approver).post(
        f"/api/approvals/{approval_id}/approve/", {}, format="json"
    )
    assert denied.status_code == 403

    approved = _client(delegate).post(
        f"/api/approvals/{approval_id}/approve/", {}, format="json"
    )
    assert approved.status_code == 200
    assert (
        approved.data["approvals"][0]["delegated_for_id"]
        == approver.user_id
    )


def test_delegate_sees_invoice_but_stranger_does_not(
    approver, clerk, department, vendor
):
    delegate = _user("U081", User.Role.APPROVER)
    stranger = _user("U082", User.Role.APPROVER)
    other = Department.objects.create(department_id="D02", name="Field Ops")
    stranger.department = other
    stranger.save(update_fields=["department"])
    _prepare_on_leave(approver, delegate)

    invoice = _invoice("5000.00", vendor, department, clerk)
    _client(clerk).post(f"/api/invoices/{invoice.invoice_id}/submit/")

    url = f"/api/invoices/{invoice.invoice_id}/"
    assert _client(delegate).get(url).status_code == 200
    assert _client(stranger).get(url).status_code == 404


def test_explicit_on_leave_approver_is_kept(
    approver, clerk, department, vendor
):
    delegate = _user("U083", User.Role.APPROVER)
    _prepare_on_leave(approver, delegate)

    _make_policy(
        "POL-EXPLICIT",
        {},
        [
            {
                "step_no": 1,
                "role": "APPROVER",
                "approver_id": approver.user_id,
            }
        ],
    )
    invoice = _invoice("5000.00", vendor, department, clerk)
    assert policy_engine.build_chain(invoice)[0].approver == approver


def test_finance_uses_explicit_approver_limit(
    approver, finance, clerk, department, vendor
):
    director = _user("U084", User.Role.APPROVER)
    _make_policy(
        "POL-EXPLICIT-LIMIT",
        {},
        [
            {
                "step_no": 1,
                "role": "APPROVER",
                "approver_id": director.user_id,
            }
        ],
    )
    invoice = _invoice("5000.00", vendor, department, clerk)

    director.approval_limit_cad = "1000.00"
    director.save(update_fields=["approval_limit_cad"])
    assert "FINANCE_MANAGER" in _roles(policy_engine.build_chain(invoice))

    director.approval_limit_cad = "100000.00"
    director.save(update_fields=["approval_limit_cad"])
    assert _roles(policy_engine.build_chain(invoice)) == ["APPROVER"]


def test_non_approver_manager_escalates(
    approver, clerk, department, vendor
):
    employee = _user("U085", User.Role.EMPLOYEE)
    director = _user("U086", User.Role.APPROVER)
    employee.manager = director
    employee.save(update_fields=["manager"])
    department.manager = employee
    department.save(update_fields=["manager"])

    invoice = _invoice("5000.00", vendor, department, clerk)
    assert policy_engine.build_chain(invoice)[0].approver == director


def test_same_person_is_not_assigned_two_steps(
    approver, finance, clerk, department, vendor
):
    department.manager = finance
    department.save(update_fields=["manager"])
    finance.department = department
    finance.save(update_fields=["department"])

    _make_policy(
        "POL-SAME-PERSON",
        {},
        [
            {"step_no": 1, "role": "APPROVER", "approver_id": None},
            {"step_no": 2, "role": "FINANCE_MANAGER", "approver_id": None},
        ],
    )
    invoice = _invoice("5000.00", vendor, department, clerk)

    steps = policy_engine.build_chain(invoice)
    assert [step.approver for step in steps] == [finance]
    assert _roles(steps) == ["FINANCE_MANAGER"]


def test_missing_department_escalates_to_finance_not_ap_manager(
    finance, clerk, vendor
):
    # The clerk's manager is Finance; without a department the chain must not
    # treat that manager as the department approver.
    clerk.manager = finance
    clerk.save(update_fields=["manager"])
    invoice = _invoice("5000.00", vendor, None, clerk)

    steps = policy_engine.build_chain(invoice)
    assert _roles(steps) == ["FINANCE_MANAGER"]
    assert steps[0].approver == finance
    assert steps[0].reason == "Department unassigned"


def test_existing_finance_reordered_before_controller(
    controller, approver, finance, clerk, department, vendor
):
    _make_policy(
        "POL-CF",
        {},
        [
            {"step_no": 1, "role": "CONTROLLER", "approver_id": None},
            {"step_no": 2, "role": "FINANCE_MANAGER", "approver_id": None},
        ],
    )
    invoice = _invoice("5000.00", vendor, department, clerk)
    assert _roles(policy_engine.build_chain(invoice)) == [
        "APPROVER",
        "FINANCE_MANAGER",
        "CONTROLLER",
    ]


@pytest.mark.parametrize(
    "conditions",
    [
        {"match": [], "rules": []},
        {
            "match": "all",
            "rules": [{"field": [], "op": "eq", "value": "x"}],
        },
        {
            "match": "all",
            "rules": [{"field": "vendor.status", "op": [], "value": "x"}],
        },
    ],
)
def test_malformed_condition_types_rejected(controller, conditions):
    response = _client(controller).post(
        "/api/policies/",
        _policy_payload(conditions=conditions),
        format="json",
    )
    assert response.status_code == 400


def test_malformed_approver_id_type_rejected(controller):
    response = _client(controller).post(
        "/api/policies/",
        _policy_payload(
            steps=[{"role": "APPROVER", "approver_id": ["U007"]}]
        ),
        format="json",
    )
    assert response.status_code == 400


def test_stored_malformed_rule_fails_closed():
    policy = ApprovalPolicy(
        conditions={
            "match": "all",
            "rules": [{"field": [], "op": "eq", "value": "x"}],
        }
    )
    context = {
        "invoice": {},
        "vendor": {"status": "active"},
        "requester": {},
    }
    assert policy_engine.condition_matches(policy, context) is False


def test_disabled_user_rejected_as_explicit_approver(controller):
    disabled = _user("U087", User.Role.APPROVER)
    disabled.is_active = False
    disabled.save(update_fields=["is_active"])

    response = _client(controller).post(
        "/api/policies/",
        _policy_payload(
            steps=[
                {
                    "role": "APPROVER",
                    "approver_id": disabled.user_id,
                }
            ]
        ),
        format="json",
    )
    assert response.status_code == 400


def test_dashboard_counts_delegated_steps(
    approver, clerk, department, vendor
):
    delegate = _user("U088", User.Role.APPROVER)
    _prepare_on_leave(approver, delegate)

    invoice = _invoice("5000.00", vendor, department, clerk)
    _client(clerk).post(f"/api/invoices/{invoice.invoice_id}/submit/")

    response = _client(delegate).get("/api/dashboard/")
    assert response.status_code == 200
    assert response.data["counts"]["pending_my_approval"] == 1


def test_patch_conditions_null_clears(controller):
    created = _client(controller).post(
        "/api/policies/", _policy_payload(), format="json"
    )
    rule_id = created.data["id"]

    response = _client(controller).patch(
        f"/api/policies/{rule_id}/", {"conditions": None}, format="json"
    )
    assert response.status_code == 200
    assert response.data["conditions"] == {}


# --- Fourth review (low) regressions ----------------------------------------


def test_finance_reasons(approver, finance, clerk, department, vendor):
    unknown_vendor = _invoice("5000.00", None, department, clerk)
    steps = policy_engine.baseline_steps(unknown_vendor)
    assert steps[1].reason == "Vendor not approved"

    no_amount = _invoice("5000.00", vendor, department, clerk)
    no_amount.currency = "USD"
    no_amount.total_cad = None
    no_amount.save(update_fields=["currency", "total_cad"])
    steps = policy_engine.baseline_steps(no_amount)
    assert steps[1].reason == "Amount in CAD unavailable"

    approver.approval_limit_cad = "1000.00"
    approver.save(update_fields=["approval_limit_cad"])
    over_limit = _invoice("5000.00", vendor, department, clerk)
    steps = policy_engine.baseline_steps(over_limit)
    assert steps[1].reason == "Above approval limit"


def test_on_leave_finance_manager_with_delegate_is_resolved(
    approver, finance, clerk, department, vendor
):
    delegate = _user("U089", User.Role.FINANCE_MANAGER)
    finance.status = User.Status.ON_LEAVE
    finance.delegate = delegate
    finance.save(update_fields=["status", "delegate"])

    invoice = _invoice("5000.00", None, department, clerk)
    steps = policy_engine.baseline_steps(invoice)
    assert steps[1].approver == finance


def test_manager_whose_delegate_is_requester_escalates(
    approver, clerk, department, vendor
):
    director = _user("U090", User.Role.APPROVER)
    approver.status = User.Status.ON_LEAVE
    approver.delegate = clerk
    approver.manager = director
    approver.save(update_fields=["status", "delegate", "manager"])

    invoice = _invoice("5000.00", vendor, department, clerk)
    assert policy_engine.build_chain(invoice)[0].approver == director


def test_invalid_match_with_empty_rules_fails_closed():
    policy = ApprovalPolicy(conditions={"match": "ANY", "rules": []})
    context = {"invoice": {}, "vendor": {}, "requester": {}}
    assert policy_engine.condition_matches(policy, context) is False


def test_on_leave_principal_has_no_actionable_view(
    approver, clerk, department, vendor
):
    delegate = _user("U091", User.Role.APPROVER)
    _prepare_on_leave(approver, delegate)

    invoice = _invoice("5000.00", vendor, department, clerk)
    _client(clerk).post(f"/api/invoices/{invoice.invoice_id}/submit/")

    principal = _client(approver).get("/api/approvals/?actionable=true")
    assert principal.status_code == 200
    assert principal.data["count"] == 0

    dashboard = _client(approver).get("/api/dashboard/")
    assert dashboard.data["counts"]["pending_my_approval"] == 0

    delegated = _client(delegate).get("/api/approvals/?actionable=true")
    assert delegated.data["count"] == 1


def test_employee_delegate_can_see_invoice(
    approver, clerk, department, vendor
):
    employee = _user("U092", User.Role.EMPLOYEE)
    _prepare_on_leave(approver, employee)

    invoice = _invoice("5000.00", vendor, department, clerk)
    _client(clerk).post(f"/api/invoices/{invoice.invoice_id}/submit/")

    url = f"/api/invoices/{invoice.invoice_id}/"
    assert _client(employee).get(url).status_code == 200

