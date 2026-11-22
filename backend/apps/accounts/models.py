from uuid import uuid4

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


def _delegation_id() -> str:
    return f"DEL-{uuid4().hex[:8].upper()}"


class Department(models.Model):
    """A cost centre / department (departments.csv)."""

    department_id = models.CharField(max_length=16, primary_key=True)
    name = models.CharField(max_length=100)
    cost_centre = models.CharField(max_length=20, blank=True, default="")
    annual_budget_cad = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    manager = models.ForeignKey(
        "User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="managed_departments",
    )

    def __str__(self) -> str:
        return f"{self.department_id} {self.name}"


class User(AbstractUser):
    """Custom user for Harborline Logistics.

    Extends Django's auth User so every authenticated principal carries an AP
    role that server-side permission checks key off (AGENTS.md §5). The dataset
    id is kept in ``user_id`` (the auth ``username`` is seeded from it so it is
    unique and stable); org fields (department, manager, delegate, limits,
    status) mirror users.csv.
    """

    class Role(models.TextChoices):
        EMPLOYEE = "EMPLOYEE", "Employee (requester)"
        AP_CLERK = "AP_CLERK", "AP Clerk"
        APPROVER = "APPROVER", "Approver (department manager)"
        FINANCE_MANAGER = "FINANCE_MANAGER", "Finance Manager"
        CONTROLLER = "CONTROLLER", "Controller / Admin"
        AUDITOR = "AUDITOR", "Auditor"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ON_LEAVE = "on_leave", "On leave"
        TERMINATED = "terminated", "Terminated"

    user_id = models.CharField(
        max_length=16, unique=True, null=True, blank=True, db_index=True
    )
    role = models.CharField(
        max_length=20, choices=Role.choices, default=Role.EMPLOYEE, db_index=True
    )
    department = models.ForeignKey(
        Department,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="members",
    )
    manager = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="direct_reports",
    )
    delegate = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="delegations_for",
    )
    approval_limit_cad = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    work_province = models.CharField(max_length=2, blank=True, default="")
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.ACTIVE, db_index=True
    )
    status_since = models.DateField(null=True, blank=True)
    title = models.CharField(max_length=100, blank=True, default="")
    hire_date = models.DateField(null=True, blank=True)

    def __str__(self) -> str:
        return f"{self.get_full_name() or self.username} ({self.role})"


class Delegation(models.Model):
    """A dated delegation of approval authority from a principal to a delegate."""

    delegation_id = models.CharField(
        max_length=32, primary_key=True, default=_delegation_id, editable=False
    )
    principal = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="delegations_given",
    )
    delegate = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="delegations_received",
    )
    starts_at = models.DateTimeField(default=timezone.now, db_index=True)
    ends_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="delegations_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-starts_at",)
        indexes = [
            models.Index(fields=["principal", "starts_at"]),
            models.Index(fields=["delegate", "starts_at"]),
        ]

    def is_active(self, at=None) -> bool:
        at = at or timezone.now()
        if self.starts_at and self.starts_at > at:
            return False
        if self.ends_at is not None and self.ends_at < at:
            return False
        return True

    def __str__(self) -> str:
        return f"{self.delegation_id}: {self.principal_id} -> {self.delegate_id}"
