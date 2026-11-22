from django.db import models


class AuditEvent(models.Model):
    """Append-only audit event (AGENTS.md §2, feature #8).

    Written in the same transaction as the material change it describes. There
    are intentionally no update/delete endpoints for this model.
    """

    actor = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_events",
    )
    action = models.CharField(max_length=64)
    entity_type = models.CharField(max_length=64, blank=True, default="")
    entity_id = models.CharField(max_length=64, blank=True, default="")
    timestamp = models.DateTimeField(auto_now_add=True)
    before = models.JSONField(default=dict, blank=True)
    after = models.JSONField(default=dict, blank=True)
    evidence = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("-timestamp",)

    def __str__(self) -> str:
        return f"{self.timestamp} {self.action} {self.entity_type}:{self.entity_id}"
