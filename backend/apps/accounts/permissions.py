"""Role-based permission helpers (docs/API_CONTRACT.md §2.2)."""

from rest_framework.permissions import BasePermission


def role_required(*roles, allow_on_leave: bool = False):
    """Return a permission class that requires one of the given roles.

    Inactive (terminated) users are always denied. Users who are ``on_leave``
    are denied write actions by default; pass ``allow_on_leave=True`` for
    read-only endpoints.
    """

    allowed = {str(role) for role in roles}

    class _RolePermission(BasePermission):
        message = "Your role cannot perform this action."

        def has_permission(self, request, view):
            user = request.user
            if not (
                user
                and user.is_authenticated
                and user.is_active
                and user.role in allowed
            ):
                return False
            if not allow_on_leave and getattr(user, "status", "active") != "active":
                return False
            return True

    return _RolePermission
