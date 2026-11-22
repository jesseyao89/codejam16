from django.db import models


class ApprovalPolicy(models.Model):
    """An approval / release / match routing rule (approval_policies.csv).

    The dataset's ``condition`` is human-readable prose; a structured,
    machine-executable policy engine is added when approval routing is built.
    """

    rule_id = models.CharField(max_length=16, primary_key=True)
    rule_type = models.CharField(max_length=32, blank=True, default="")
    condition = models.CharField(max_length=255, blank=True, default="")
    required = models.CharField(max_length=255, blank=True, default="")
    notes = models.CharField(max_length=255, blank=True, default="")

    def __str__(self) -> str:
        return f"{self.rule_id} ({self.rule_type})"


class ApprovalStep(models.Model):
    """A single approval decision on an invoice (approvals.csv / workflow)."""

    class Action(models.TextChoices):
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    approval_id = models.CharField(max_length=32, primary_key=True)
    invoice = models.ForeignKey(
        "invoices.Invoice",
        on_delete=models.CASCADE,
        related_name="approval_steps",
    )
    step_no = models.IntegerField()
    approver = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="approval_steps",
    )
    delegated_for = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="delegated_approval_steps",
    )
    approver_role = models.CharField(max_length=32, blank=True, default="")
    action = models.CharField(max_length=16, choices=Action.choices)
    acted_at = models.DateTimeField(null=True, blank=True)
    comment = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ("invoice", "step_no")

    def __str__(self) -> str:
        return self.approval_id
