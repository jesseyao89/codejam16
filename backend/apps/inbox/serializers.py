"""Inbox serializers (contract §4)."""

from rest_framework import serializers

from apps.inbox.models import Email, EmailAttachment
from apps.invoices.serializers import UTCDateTimeField


class EmailAttachmentSerializer(serializers.ModelSerializer):
    invoice_id = serializers.SerializerMethodField()

    class Meta:
        model = EmailAttachment
        fields = [
            "filename",
            "content_type",
            "order",
            "status",
            "invoice_id",
            "error",
        ]

    def get_invoice_id(self, obj):
        return obj.invoice.invoice_id if obj.invoice else None


class EmailSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="email_id")
    received_at = UTCDateTimeField(read_only=True)
    body_excerpt = serializers.SerializerMethodField()
    attachment = serializers.SerializerMethodField()
    attachments = EmailAttachmentSerializer(many=True, read_only=True)
    invoice_id = serializers.SerializerMethodField()
    invoice_ids = serializers.SerializerMethodField()

    class Meta:
        model = Email
        fields = [
            "id",
            "sender",
            "from_name",
            "subject",
            "received_at",
            "body_excerpt",
            "attachment",
            "attachments",
            "classification",
            "classification_confidence",
            "invoice_id",
            "invoice_ids",
            "status",
        ]

    def get_body_excerpt(self, obj):
        return (obj.body or "")[:300]

    def get_attachment(self, obj):
        first = obj.attachments.first()
        if first is None:
            return None
        return {"filename": first.filename, "content_type": first.content_type}

    def _invoiced_attachments(self, obj):
        return [a for a in obj.attachments.all() if a.invoice_id]

    def get_invoice_id(self, obj):
        # Stay coherent with `attachment` (the primary/first attachment).
        first = obj.attachments.first()
        if first is not None and first.invoice_id:
            return first.invoice.invoice_id
        return None

    def get_invoice_ids(self, obj):
        return [a.invoice.invoice_id for a in self._invoiced_attachments(obj)]
