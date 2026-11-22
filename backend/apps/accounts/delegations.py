"""Delegation domain helpers (contract §7.3).

A delegation is a dated grant of approval authority. The versioned model is
authoritative; the legacy ``User.delegate`` + ``on_leave`` pair is still
honoured as a fallback for dataset rows that predate the model.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.accounts.models import Delegation, User
from apps.audit.services import record_audit

DELEGABLE_ROLES = {
    User.Role.APPROVER,
    User.Role.FINANCE_MANAGER,
    User.Role.CONTROLLER,
}


class DelegationValidationError(ValueError):
    """A clean validation failure for the delegation API."""

    def __init__(self, message: str, code: str = "VALIDATION_ERROR"):
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass(frozen=True)
class LegacyDelegation:
    """A seeded ``User.delegate`` that has no ``Delegation`` row yet."""

    principal_id: int
    delegate_id: int
    delegation_id: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


def _at(value=None):
    return value or timezone.now()


def active_delegations(principal=None, delegate=None, at=None):
    at = _at(at)
    queryset = Delegation.objects.filter(starts_at__lte=at).filter(
        Q(ends_at__isnull=True) | Q(ends_at__gte=at)
    )
    if principal is not None:
        queryset = queryset.filter(principal=principal)
    if delegate is not None:
        queryset = queryset.filter(delegate=delegate)
    return queryset.order_by("-starts_at", "-created_at")


def active_delegation_for(principal, at=None):
    if principal is None:
        return None
    delegation = active_delegations(principal=principal, at=at).first()
    if delegation is not None:
        return delegation
    # Fall back to the seeded pair only when the principal has no Delegation
    # rows at all. Once a proper row exists (even if ended), it is authoritative.
    if Delegation.objects.filter(principal=principal).exists():
        return None
    if principal.status == User.Status.ON_LEAVE and principal.delegate_id:
        return LegacyDelegation(
            principal_id=principal.pk,
            delegate_id=principal.delegate_id,
        )
    return None


def active_delegate_for(principal, at=None):
    delegation = active_delegation_for(principal, at=at)
    if delegation is None:
        return None
    return User.objects.filter(pk=delegation.delegate_id).first()


def principals_for_delegate(delegate, at=None) -> set[int]:
    if delegate is None:
        return set()
    at = _at(at)
    ids = set(
        Delegation.objects.filter(
            delegate=delegate,
            starts_at__lte=at,
            principal__status__in=(User.Status.ACTIVE, User.Status.ON_LEAVE),
        )
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gte=at))
        .values_list("principal_id", flat=True)
    )
    ids.update(
        User.objects.filter(
            delegate=delegate, status=User.Status.ON_LEAVE
        )
        .exclude(delegations_given__isnull=False)
        .values_list("pk", flat=True)
    )
    return ids


def is_active_delegate(principal, delegate, at=None) -> bool:
    if principal is None or delegate is None:
        return False
    if principal.status == User.Status.TERMINATED:
        return False
    if active_delegations(
        principal=principal, delegate=delegate, at=at
    ).exists():
        return True
    # A migrated principal with any Delegation row (even an ended one) must not
    # fall back to the legacy pair.
    if Delegation.objects.filter(principal=principal).exists():
        return False
    return (
        principal.delegate_id == delegate.pk
        and principal.status == User.Status.ON_LEAVE
    )


def _validate_principal_and_delegate(principal, delegate):
    if principal is None or delegate is None:
        raise DelegationValidationError("principal and delegate are required.")
    if principal.pk == delegate.pk:
        raise DelegationValidationError(
            "A principal cannot delegate to themselves."
        )
    if principal.role not in DELEGABLE_ROLES:
        raise DelegationValidationError(
            "Only approvers, finance managers and controllers can delegate."
        )
    if delegate.role not in DELEGABLE_ROLES:
        raise DelegationValidationError(
            "The delegate must be an approver, finance manager or controller."
        )
    if principal.status == User.Status.TERMINATED or not principal.is_active:
        raise DelegationValidationError("The principal is not active.")
    if delegate.status != User.Status.ACTIVE or not delegate.is_active:
        raise DelegationValidationError("The delegate is not active.")


def _overlapping_delegation(principal, starts_at, ends_at):
    queryset = Delegation.objects.filter(principal=principal).filter(
        starts_at__lt=ends_at
    ) if ends_at else Delegation.objects.filter(principal=principal)
    queryset = queryset.filter(
        Q(ends_at__isnull=True) | Q(ends_at__gt=starts_at)
    )
    return queryset.order_by("starts_at").first()


def create_delegation(
    principal,
    delegate,
    *,
    starts_at=None,
    ends_at=None,
    actor=None,
):
    _validate_principal_and_delegate(principal, delegate)
    starts_at = _at(starts_at)
    if ends_at is not None and ends_at <= starts_at:
        raise DelegationValidationError(
            "ends_at must be after starts_at."
        )

    with transaction.atomic():
        overlapping = _overlapping_delegation(principal, starts_at, ends_at)
        if overlapping is not None:
            raise DelegationValidationError(
                "This principal already has an overlapping delegation."
            )
        delegation = Delegation.objects.create(
            principal=principal,
            delegate=delegate,
            starts_at=starts_at,
            ends_at=ends_at,
            created_by=actor,
        )
        record_audit(
            actor,
            "DELEGATION_CREATED",
            "DELEGATION",
            delegation.delegation_id,
            after={
                "principal_id": principal.user_id,
                "delegate_id": delegate.user_id,
                "starts_at": starts_at.isoformat(),
                "ends_at": ends_at.isoformat() if ends_at else None,
            },
        )
    return delegation


def end_delegation(delegation, actor=None, *, at=None):
    at = _at(at)
    with transaction.atomic():
        locked = Delegation.objects.select_for_update().get(
            pk=delegation.pk
        )
        was_active = locked.is_active(at)
        before = {
            "principal_id": locked.principal.user_id,
            "delegate_id": locked.delegate.user_id,
            "ends_at": locked.ends_at.isoformat() if locked.ends_at else None,
            "active": was_active,
        }
        if was_active:
            locked.ends_at = at
            locked.save(update_fields=["ends_at"])
        record_audit(
            actor,
            "DELEGATION_ENDED",
            "DELEGATION",
            locked.delegation_id,
            before=before,
            after={
                "principal_id": locked.principal.user_id,
                "delegate_id": locked.delegate.user_id,
                "ends_at": locked.ends_at.isoformat() if locked.ends_at else None,
                "active": False,
            },
            evidence={"already_ended": not was_active},
        )
    return locked
