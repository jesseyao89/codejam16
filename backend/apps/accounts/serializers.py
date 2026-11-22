"""Serializers for the accounts app (contract §2 User shape)."""

from rest_framework import serializers

from apps.accounts.models import Delegation, Department, User


class DepartmentSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="department_id")

    class Meta:
        model = Department
        fields = ["id", "name"]


class UserSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="user_id", allow_null=True)
    full_name = serializers.CharField(source="get_full_name", read_only=True)
    department = DepartmentSerializer(read_only=True)
    manager_id = serializers.SerializerMethodField()
    delegate_id = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "full_name",
            "email",
            "role",
            "title",
            "department",
            "manager_id",
            "delegate_id",
            "approval_limit_cad",
            "work_province",
            "status",
        ]

    def get_manager_id(self, obj) -> str | None:
        return obj.manager.user_id if obj.manager else None

    def get_delegate_id(self, obj) -> str | None:
        return obj.delegate.user_id if obj.delegate else None


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(
        write_only=True, style={"input_type": "password"}
    )


class DelegationSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="delegation_id")
    principal_id = serializers.SerializerMethodField()
    delegate_id = serializers.SerializerMethodField()
    active = serializers.SerializerMethodField()

    class Meta:
        model = Delegation
        fields = [
            "id",
            "principal_id",
            "delegate_id",
            "starts_at",
            "ends_at",
            "active",
        ]

    def get_principal_id(self, obj) -> str | None:
        return obj.principal.user_id if obj.principal else None

    def get_delegate_id(self, obj) -> str | None:
        return obj.delegate.user_id if obj.delegate else None

    def get_active(self, obj) -> bool:
        return obj.is_active()


class DelegationWriteSerializer(serializers.Serializer):
    principal_id = serializers.CharField(required=False, allow_null=True)
    delegate_id = serializers.CharField()
    starts_at = serializers.DateTimeField(required=False, allow_null=True)
    ends_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate(self, attrs):
        if attrs.get("ends_at") and attrs.get("starts_at"):
            if attrs["ends_at"] <= attrs["starts_at"]:
                raise serializers.ValidationError(
                    {"ends_at": "ends_at must be after starts_at."}
                )
        return attrs
