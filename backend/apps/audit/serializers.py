"""Audit event serializer (contract §9)."""

from rest_framework import serializers

from apps.audit.models import AuditEvent
from apps.invoices.serializers import UTCDateTimeField


class AuditEventSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    actor_id = serializers.SerializerMethodField()
    actor_name = serializers.SerializerMethodField()
    on_behalf_of_id = serializers.SerializerMethodField()
    timestamp = UTCDateTimeField(read_only=True)

    class Meta:
        model = AuditEvent
        fields = [
            "id",
            "actor_id",
            "actor_name",
            "on_behalf_of_id",
            "action",
            "entity_type",
            "entity_id",
            "before",
            "after",
            "evidence",
            "timestamp",
        ]

    def get_id(self, obj):
        return f"AUD-{obj.pk:05d}"

    def get_actor_id(self, obj):
        return obj.actor.user_id if obj.actor else None

    def get_actor_name(self, obj):
        return obj.actor.get_full_name() if obj.actor else None

    def get_on_behalf_of_id(self, obj):
        return (obj.evidence or {}).get("on_behalf_of")
