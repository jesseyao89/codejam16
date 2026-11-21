from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Custom user for Harborline Logistics.

    Extends Django's auth User so every authenticated principal carries an AP
    role that server-side permission checks key off (AGENTS.md §5).

    Kept intentionally minimal for the walking skeleton. Org structure
    (department, manager, delegate, approval limits, status) is added in the
    data-modelling step alongside the `load_dataset` command.
    """

    class Role(models.TextChoices):
        EMPLOYEE = "EMPLOYEE", "Employee (requester)"
        AP_CLERK = "AP_CLERK", "AP Clerk"
        APPROVER = "APPROVER", "Approver (department manager)"
        FINANCE_MANAGER = "FINANCE_MANAGER", "Finance Manager"
        CONTROLLER = "CONTROLLER", "Controller / Admin"
        AUDITOR = "AUDITOR", "Auditor"

    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.EMPLOYEE,
        db_index=True,
    )

    def __str__(self) -> str:
        return f"{self.get_full_name() or self.username} ({self.role})"
