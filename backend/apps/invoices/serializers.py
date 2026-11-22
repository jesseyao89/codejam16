from rest_framework import serializers

from apps.accounts.models import Department
from apps.invoices.models import GLAccount, TaxCode


class ReferenceDepartmentSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="department_id")
    manager_id = serializers.CharField(
        source="manager.user_id", allow_null=True, read_only=True
    )

    class Meta:
        model = Department
        fields = ["id", "name", "cost_centre", "annual_budget_cad", "manager_id"]


class GLAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = GLAccount
        fields = ["account_number", "name", "account_type", "notes"]


class TaxCodeSerializer(serializers.ModelSerializer):
    rate = serializers.SerializerMethodField()

    class Meta:
        model = TaxCode
        fields = [
            "code",
            "description",
            "rate",
            "applies_to",
            "recoverable",
            "gl_account",
        ]

    def get_rate(self, obj: TaxCode) -> str | None:
        """Serialise a rate without the model's trailing zeros.

        The DB column is ``decimal_places=5``, so a plain ``DecimalField``
        renders "0.05000"/"0.00000". The contract uses "0.05"/"0".
        """
        if obj.rate is None:
            return None
        return format(obj.rate.normalize(), "f")
