"""Role-based permission helpers (docs/API_CONTRACT.md §2.2)."""

from rest_framework.permissions import BasePermission


def role_required(*roles):
    """Return a permission class that requires one of the given roles."""

    allowed = {str(role) for role in roles}

    class _RolePermission(BasePermission):
        message = "Your role cannot perform this action."

        def has_permission(self, request, view):
            user = request.user
            return bool(
                user
                and user.is_authenticated
                and user.is_active
                and user.role in allowed
            )

    return _RolePermission
