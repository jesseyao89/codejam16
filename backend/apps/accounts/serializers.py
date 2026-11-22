"""Serializers for the accounts app (contract §2 User shape)."""

from rest_framework import serializers

from apps.accounts.models import Department, User


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
