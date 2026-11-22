"""Payment serializers (contract §8)."""

from rest_framework import serializers

from apps.invoices.serializers import UTCDateTimeField
from apps.payments.models import Payment


class PaymentSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="payment_id")
    invoice_id = serializers.SerializerMethodField()
    bank_account_masked = serializers.SerializerMethodField()
    prepared_by_id = serializers.SerializerMethodField()
    released_by_id = serializers.SerializerMethodField()
    failure_reason = serializers.SerializerMethodField()
    created_at = UTCDateTimeField(read_only=True)

    class Meta:
        model = Payment
        fields = [
            "id",
            "invoice_id",
            "status",
            "method",
            "currency",
            "amount",
            "fx_rate_to_cad",
            "amount_cad",
            "discount_taken",
            "reference",
            "scheduled_date",
            "paid_date",
            "bank_account_masked",
            "prepared_by_id",
            "released_by_id",
            "failure_reason",
            "created_at",
        ]

    def get_invoice_id(self, obj):
        return obj.invoice.invoice_id if obj.invoice else None

    def get_bank_account_masked(self, obj):
        if obj.vendor and obj.vendor.bank_account:
            return "**** " + obj.vendor.bank_account[-4:]
        return None

    def get_prepared_by_id(self, obj):
        return obj.prepared_by.user_id if obj.prepared_by else None

    def get_released_by_id(self, obj):
        return obj.released_by.user_id if obj.released_by else None

    def get_failure_reason(self, obj):
        # No failure path yet; the contract allows null.
        return None
