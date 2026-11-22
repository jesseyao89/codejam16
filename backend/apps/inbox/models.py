"""AP inbox: email metadata plus one record per attachment (contract §4)."""

from django.db import models


class Email(models.Model):
    class Classification(models.TextChoices):
        INVOICE = "INVOICE", "Invoice"
        NOT_INVOICE = "NOT_INVOICE", "Not an invoice"
        UNCERTAIN = "UNCERTAIN", "Uncertain"

    class Status(models.TextChoices):
        NEW = "NEW", "New"
        INGESTED = "INGESTED", "Ingested"
        PARTIAL = "PARTIAL", "Partially ingested"
        ROUTED = "ROUTED", "Routed"
        DISMISSED = "DISMISSED", "Dismissed"

    email_id = models.CharField(max_length=32, primary_key=True)
    sender = models.CharField(max_length=255, blank=True, default="")
    from_name = models.CharField(max_length=255, blank=True, default="")
    to_address = models.CharField(max_length=255, blank=True, default="")
    subject = models.CharField(max_length=255, blank=True, default="")
    received_at = models.DateTimeField(null=True, blank=True)
    body = models.TextField(blank=True, default="")
    classification = models.CharField(
        max_length=16,
        choices=Classification.choices,
        default=Classification.UNCERTAIN,
        db_index=True,
    )
    classification_confidence = models.CharField(
        max_length=8, blank=True, default=""
    )
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.NEW, db_index=True
    )
    processed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-received_at", "email_id")

    def __str__(self) -> str:
        return self.email_id


class EmailAttachment(models.Model):
    class Status(models.TextChoices):
        NEW = "NEW", "New"
        INGESTED = "INGESTED", "Ingested"
        FAILED = "FAILED", "Failed"

    email = models.ForeignKey(
        Email, on_delete=models.CASCADE, related_name="attachments"
    )
    order = models.IntegerField(default=0)
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=64, blank=True, default="")
    invoice = models.ForeignKey(
        "invoices.Invoice",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="source_attachments",
    )
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.NEW
    )
    error = models.CharField(max_length=255, blank=True, default="")
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("email", "order")
        unique_together = (("email", "filename"),)

    def __str__(self) -> str:
        return f"{self.email_id}:{self.filename}"
