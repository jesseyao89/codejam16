"""Vendor and bank-change serializers (contract §6)."""

from rest_framework import serializers

from apps.invoices.serializers import UTCDateTimeField
from apps.vendors.models import BankChange, Vendor


class BankChangeSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="change_id")
    vendor_id = serializers.CharField(source="vendor.vendor_id", read_only=True)
    status = serializers.CharField(allow_null=True)
    requested_by_id = serializers.SerializerMethodField()
    decided_by_id = serializers.SerializerMethodField()
    decided_at = UTCDateTimeField(read_only=True)

    class Meta:
        model = BankChange
        fields = [
            "id",
            "vendor_id",
            "status",
            "changed_at",
            "requested_by_id",
            "request_channel",
            "verified_by_callback",
            "old_account_last4",
            "new_account_last4",
            "note",
            "decided_by_id",
            "decided_at",
        ]

    def get_requested_by_id(self, obj) -> str | None:
        return obj.changed_by.user_id if obj.changed_by else None

    def get_decided_by_id(self, obj) -> str | None:
        return obj.decided_by.user_id if obj.decided_by else None


class VendorSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="vendor_id")
    bank_account_masked = serializers.SerializerMethodField()
    bank_institution = serializers.SerializerMethodField()
    pending_bank_change = serializers.SerializerMethodField()

    class Meta:
        model = Vendor
        fields = [
            "id",
            "legal_name",
            "category",
            "default_gl_account",
            "address",
            "province_or_state",
            "country",
            "gst_hst_number",
            "qst_number",
            "payment_terms_days",
            "early_pay_discount",
            "preferred_payment_method",
            "accepts_card_payment",
            "bank_institution",
            "bank_account_masked",
            "bank_details_updated_at",
            "ap_contact_email",
            "requires_po",
            "status",
            "onboarded_at",
            "pending_bank_change",
        ]

    def get_bank_account_masked(self, obj: Vendor) -> str | None:
        if not obj.bank_account:
            return None
        return "**** " + obj.bank_account[-4:]

    def get_bank_institution(self, obj: Vendor) -> str | None:
        return "***" if obj.bank_institution else None

    def get_pending_bank_change(self, obj: Vendor):
        pending = getattr(obj, "pending_changes", None)
        if pending is None:
            pending = list(
                obj.bank_changes.filter(status=BankChange.Status.PENDING).order_by(
                    "-changed_at"
                )
            )
        change = pending[0] if pending else None
        return BankChangeSerializer(change).data if change else None


class VendorWriteSerializer(serializers.ModelSerializer):
    """Shape validation for onboarding/PATCH (services own the policy)."""

    class Meta:
        model = Vendor
        fields = [
            "legal_name",
            "category",
            "default_gl_account",
            "address",
            "province_or_state",
            "country",
            "gst_hst_number",
            "qst_number",
            "payment_terms_days",
            "early_pay_discount",
            "preferred_payment_method",
            "accepts_card_payment",
            "ap_contact_email",
            "requires_po",
        ]
        extra_kwargs = {
            "legal_name": {"required": True, "allow_blank": False},
            "payment_terms_days": {
                "required": False,
                "allow_null": True,
                "min_value": 0,
            },
        }

    def validate(self, attrs):
        unknown = set(self.initial_data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError(
                {"detail": f"Unknown fields: {sorted(unknown)}"}
            )
        return attrs

    def validate_legal_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field may not be blank.")
        return value


class BankChangeRequestSerializer(serializers.Serializer):
    bank_account = serializers.CharField(max_length=32)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)

