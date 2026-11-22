from rest_framework import serializers

from apps.vendors.models import BankChange, Vendor


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

    def get_pending_bank_change(self, obj: Vendor) -> None:
        return None


class BankChangeSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="change_id")
    vendor_id = serializers.CharField(source="vendor.vendor_id", read_only=True)
    status = serializers.SerializerMethodField()
    requested_by_id = serializers.CharField(
        source="changed_by.user_id", allow_null=True, read_only=True
    )
    decided_by_id = serializers.SerializerMethodField()
    decided_at = serializers.SerializerMethodField()

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
            "decided_by_id",
            "decided_at",
        ]

    def get_status(self, obj: BankChange) -> None:
        return None

    def get_decided_by_id(self, obj: BankChange) -> None:
        return None

    def get_decided_at(self, obj: BankChange) -> None:
        return None
