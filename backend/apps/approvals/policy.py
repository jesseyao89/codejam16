"""Bounded approval-policy engine (contract §7.2).

Policies are flat condition lists (whitelisted fields/operators) plus ordered
steps. Matching policies are merged additively; deterministic invariants
(department-manager step, finance above the manager's limit, no self-approval)
are always applied. If no active policy matches, the baseline router is used.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation

from django.utils import timezone

from apps.accounts.delegations import active_delegate_for
from apps.accounts.models import User
from apps.approvals.models import ApprovalPolicy, ApprovalStep
from apps.vendors.models import Vendor

NEW_VENDOR_DAYS = 90
MAX_RULES = 20
MAX_STEPS = 10

FIELD_TYPES = {
    "invoice.total_cad": "money",
    "invoice.currency": "string",
    "invoice.ship_to_province": "string",
    "invoice.has_po": "bool",
    "invoice.has_contract": "bool",
    "invoice.is_credit_note": "bool",
    "invoice.department_id": "string",
    "invoice.requester_id": "string",
    "vendor.status": "string",
    "vendor.category": "string",
    "vendor.province_or_state": "string",
    "vendor.requires_po": "bool",
    "vendor.is_new": "bool",
    "vendor.onboarded_at": "date",
    "requester.role": "string",
    "requester.department_id": "string",
}

OPERATORS_BY_TYPE = {
    "money": {"eq", "ne", "gt", "gte", "lt", "lte", "is_null", "is_not_null"},
    "date": {"eq", "ne", "gt", "gte", "lt", "lte", "is_null", "is_not_null"},
    "bool": {"eq", "ne", "is_null", "is_not_null"},
    "string": {"eq", "ne", "in", "not_in", "contains", "is_null", "is_not_null"},
}

ROLES = {"APPROVER", "FINANCE_MANAGER", "CONTROLLER"}


def coerce_value(value, field_type: str):
    """Coerce a JSON value to the field's comparison type (raises ValueError)."""
    if field_type == "money":
        try:
            parsed = Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError):
            raise ValueError("Expected a decimal amount.")
        if not parsed.is_finite():
            raise ValueError("Expected a finite decimal amount.")
        return parsed
    if field_type == "bool":
        if isinstance(value, bool):
            return value
        text = str(value).strip().lower()
        if text in ("true", "1", "yes"):
            return True
        if text in ("false", "0", "no"):
            return False
        raise ValueError("Expected a boolean.")
    if field_type == "date":
        try:
            return date.fromisoformat(str(value)[:10])
        except (TypeError, ValueError):
            raise ValueError("Expected an ISO date (YYYY-MM-DD).")
    if not isinstance(value, str):
        raise ValueError("Expected a string.")
    return value


def _as_decimal(value) -> Decimal | None:
    if value is None:
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return parsed if parsed.is_finite() else None


def _as_date(value):
    if value is None:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _total_cad(invoice) -> Decimal | None:
    if invoice.total_cad is not None:
        return _as_decimal(invoice.total_cad)
    if (invoice.currency or "").upper() == "CAD":
        return _as_decimal(invoice.total)
    return None


def build_context(invoice) -> dict:
    vendor = invoice.vendor
    requester = invoice.requester

    total = _as_decimal(invoice.total)
    is_credit = total is not None and total < 0
    if not is_credit:
        is_credit = invoice.lines.filter(amount__lt=0).exists()

    onboarded_at = _as_date(vendor.onboarded_at) if vendor else None
    is_new = False
    if vendor is not None:
        if vendor.status == Vendor.Status.PENDING_REVIEW:
            is_new = True
        elif onboarded_at is not None:
            age = (timezone.localdate() - onboarded_at).days
            is_new = 0 <= age <= NEW_VENDOR_DAYS

    return {
        "invoice": {
            "total_cad": _total_cad(invoice),
            "currency": invoice.currency or None,
            "ship_to_province": invoice.ship_to_province or None,
            "has_po": invoice.po_id is not None,
            "has_contract": invoice.contract_id is not None,
            "is_credit_note": is_credit,
            "department_id": invoice.department_id,
            "requester_id": requester.user_id if requester else None,
        },
        "vendor": {
            "status": vendor.status if vendor else None,
            "category": vendor.category if vendor else None,
            "province_or_state": vendor.province_or_state if vendor else None,
            "requires_po": bool(
                vendor
                and (vendor.requires_po or "").strip().lower()
                in ("yes", "true", "1")
            ),
            "is_new": is_new,
            "onboarded_at": onboarded_at,
        },
        "requester": {
            "role": requester.role if requester else None,
            "department_id": requester.department_id if requester else None,
        },
    }


def _get(context: dict, path: str):
    node = context
    for part in path.split("."):
        if not isinstance(node, dict):
            return None
        node = node.get(part)
        if node is None:
            return None
    return node


def evaluate_rule(rule: dict, context: dict) -> bool:
    if not isinstance(rule, dict):
        return False
    field = rule.get("field")
    op = rule.get("op")
    if not isinstance(field, str) or not isinstance(op, str):
        return False
    field_type = FIELD_TYPES.get(field)
    if field_type is None or op not in OPERATORS_BY_TYPE[field_type]:
        return False

    actual = _get(context, field)
    if op == "is_null":
        return actual is None
    if op == "is_not_null":
        return actual is not None
    if actual is None:
        return False

    if op in ("in", "not_in"):
        raw = rule.get("value")
        if not isinstance(raw, list):
            return False
        try:
            expected = [coerce_value(item, field_type) for item in raw]
        except ValueError:
            return False
        if field_type == "string":
            actual_cf = str(actual).casefold()
            result = actual_cf in {str(item).casefold() for item in expected}
        else:
            result = actual in expected
        return result if op == "in" else not result

    try:
        expected = coerce_value(rule.get("value"), field_type)
    except ValueError:
        return False

    if field_type == "string":
        left, right = str(actual).casefold(), str(expected).casefold()
        if op == "eq":
            return left == right
        if op == "ne":
            return left != right
        if op == "contains":
            return right in left
        return False

    if op == "eq":
        return actual == expected
    if op == "ne":
        return actual != expected
    if op == "gt":
        return actual > expected
    if op == "gte":
        return actual >= expected
    if op == "lt":
        return actual < expected
    if op == "lte":
        return actual <= expected
    return False


def condition_matches(policy: ApprovalPolicy, context: dict) -> bool:
    conditions = policy.conditions
    if not isinstance(conditions, dict):
        # Malformed policy: fail closed rather than matching everything.
        return False
    if "rules" not in conditions:
        return True

    match = conditions.get("match", "all")
    if not isinstance(match, str) or match not in ("all", "any"):
        return False

    raw_rules = conditions.get("rules")
    if not isinstance(raw_rules, list):
        return False
    if not raw_rules:
        return True
    if not all(isinstance(rule, dict) for rule in raw_rules):
        return False

    results = [evaluate_rule(rule, context) for rule in raw_rules]
    return any(results) if match == "any" else all(results)


def matching_policies(invoice) -> list[ApprovalPolicy]:
    context = build_context(invoice)
    # Structured policies are ``approval``; direct/admin rows may leave the
    # provenance field blank. ``payment_release``/``match`` rows are excluded.
    policies = ApprovalPolicy.objects.filter(
        active=True, rule_type__in=("approval", "")
    ).order_by("priority", "rule_id")

    matched = []
    for policy in policies:
        # Prose/reference rows have no structured steps and are not executable.
        if not isinstance(policy.steps, list) or not policy.steps:
            continue
        if condition_matches(policy, context):
            matched.append(policy)
    return matched


def _department_manager(invoice, exclude=None):
    manager = invoice.department.manager if invoice.department else None
    if manager is None and invoice.requester and invoice.requester.manager:
        manager = invoice.requester.manager

    seen = set()
    while manager is not None and manager.pk not in seen:
        seen.add(manager.pk)

        if exclude is not None and manager.pk == exclude.pk:
            manager = manager.manager
            continue
        # Only approver-capable roles can hold an APPROVER step.
        if manager.role not in ROLES:
            manager = manager.manager
            continue
        if not manager.is_active:
            manager = manager.manager
            continue
        if manager.status == User.Status.ACTIVE:
            return manager
        delegate = active_delegate_for(manager)
        if (
            delegate is not None
            and delegate.pk != invoice.requester_id
            and delegate.is_active
            and delegate.status == User.Status.ACTIVE
        ):
            # The delegate can act; keep the principal on the step.
            return manager

        manager = manager.manager

    return None


def _first_active(role: str, exclude=None, requester=None):
    """First usable user for a role, preferring active over on-leave.

    An on-leave user is usable when they have an active delegate who is not the
    requester (the delegate acts and is audited as such).
    """
    queryset = User.objects.filter(role=role, is_active=True).order_by("user_id")
    for candidate in queryset:
        if exclude is not None and candidate.pk == exclude.pk:
            continue
        if candidate.status == User.Status.ACTIVE:
            return candidate
        delegate = active_delegate_for(candidate)
        if (
            delegate is not None
            and (requester is None or delegate.pk != requester.pk)
            and delegate.is_active
            and delegate.status == User.Status.ACTIVE
        ):
            return candidate
    return None


def resolve_approver(role: str, invoice):
    requester = invoice.requester
    if role == "APPROVER":
        return _department_manager(invoice, exclude=requester)
    if role == "FINANCE_MANAGER":
        return _first_active(
            User.Role.FINANCE_MANAGER, exclude=requester, requester=requester
        )
    if role == "CONTROLLER":
        return _first_active(
            User.Role.CONTROLLER, exclude=requester, requester=requester
        )
    return None


def _step(invoice, step_no, role, approver, reason) -> ApprovalStep:
    return ApprovalStep(
        invoice=invoice,
        step_no=step_no,
        approver=approver,
        approver_role=role,
        action="",
        reason=(reason or "")[:255],
    )


def baseline_steps(invoice, start_step_no: int = 1) -> list[ApprovalStep]:
    approver = _department_manager(invoice, exclude=invoice.requester)

    specs = [("APPROVER", approver, "Department manager")]
    amount = _total_cad(invoice)
    manager_limit = _as_decimal(approver.approval_limit_cad) if approver else None
    finance_reason = None
    if amount is None:
        finance_reason = "Amount in CAD unavailable"
    elif invoice.vendor is None or invoice.vendor.status != Vendor.Status.ACTIVE:
        finance_reason = "Vendor not approved"
    elif manager_limit is not None and amount > manager_limit:
        finance_reason = "Above approval limit"
    if finance_reason:
        specs.append(
            (
                "FINANCE_MANAGER",
                resolve_approver("FINANCE_MANAGER", invoice),
                finance_reason,
            )
        )

    return [
        _step(invoice, start_step_no + offset, role, approver, reason)
        for offset, (role, approver, reason) in enumerate(specs)
    ]


def _explicit_approver(explicit, role, invoice):
    """Return the named approver if assignable, else ``None``."""
    if not isinstance(explicit, str) or not explicit:
        return None
    candidate = User.objects.filter(user_id=explicit).first()
    if candidate is None or not candidate.is_active or candidate.role != role:
        return None
    if candidate.status == User.Status.ACTIVE:
        return candidate
    delegate = active_delegate_for(candidate)
    if (
        delegate is not None
        and delegate.pk != invoice.requester_id
        and delegate.is_active
        and delegate.status == User.Status.ACTIVE
    ):
        # Keep the principal so the delegate acts (and is audited as such).
        return candidate
    return None


def build_chain(invoice, start_step_no: int = 1) -> list[ApprovalStep]:
    matched = matching_policies(invoice)
    if not matched:
        return baseline_steps(invoice, start_step_no)

    specs = []
    for policy in matched:
        policy_steps = policy.steps if isinstance(policy.steps, list) else []
        for spec in policy_steps:
            if not isinstance(spec, dict):
                continue
            role = str(spec.get("role") or "").upper()
            if role not in ROLES:
                continue
            approver = _explicit_approver(
                spec.get("approver_id"), role, invoice
            )
            if approver is None or approver == invoice.requester:
                approver = resolve_approver(role, invoice)
            specs.append((role, approver, policy))

    if not any(role == "APPROVER" for role, _, _ in specs):
        specs.insert(
            0, ("APPROVER", resolve_approver("APPROVER", invoice), None)
        )

    # The finance invariant follows the approver who will actually act.
    approver_limits = [
        _as_decimal(approver.approval_limit_cad)
        for role, approver, _ in specs
        if role == "APPROVER" and approver is not None
    ]
    approver_limits = [limit for limit in approver_limits if limit is not None]
    manager_limit = min(approver_limits) if approver_limits else None

    amount = _total_cad(invoice)
    finance_reason = None
    if amount is None:
        finance_reason = "Amount in CAD unavailable"
    elif invoice.vendor is None or invoice.vendor.status != Vendor.Status.ACTIVE:
        finance_reason = "Vendor not approved"
    elif manager_limit is not None and amount > manager_limit:
        finance_reason = "Above approval limit"

    if finance_reason and not any(
        role == "FINANCE_MANAGER" for role, _, _ in specs
    ):
        specs.append(
            ("FINANCE_MANAGER", resolve_approver("FINANCE_MANAGER", invoice), None)
        )

    # Manager -> finance -> controller, even for an existing finance step.
    if any(role == "CONTROLLER" for role, _, _ in specs):
        finance_steps = [spec for spec in specs if spec[0] == "FINANCE_MANAGER"]
        other_specs = [spec for spec in specs if spec[0] != "FINANCE_MANAGER"]
        index = next(
            (
                offset
                for offset, (role, _, _) in enumerate(other_specs)
                if role == "CONTROLLER"
            ),
            len(other_specs),
        )
        specs = other_specs[:index] + finance_steps + other_specs[index:]

    deduped = []
    seen = set()
    for role, approver, policy in specs:
        key = (role, approver.pk if approver else None)
        if key in seen:
            continue
        seen.add(key)
        deduped.append((role, approver, policy))

    steps = []
    for offset, (role, approver, policy) in enumerate(deduped):
        if policy is not None:
            reason = f"Policy {policy.name or policy.rule_id}"
        elif role == "APPROVER":
            reason = "Department manager"
        elif role == "FINANCE_MANAGER":
            reason = finance_reason or "Above approval limit"
        else:
            reason = role.replace("_", " ").title()
        steps.append(
            _step(invoice, start_step_no + offset, role, approver, reason)
        )
    return steps
