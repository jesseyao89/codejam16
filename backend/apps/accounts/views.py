"""Auth endpoints: login, logout, me (docs/API_CONTRACT.md §2)."""

from django.contrib.auth import authenticate
from django.db.models import Q
from rest_framework import generics, status
from rest_framework.authtoken.models import Token
from rest_framework.exceptions import (
    AuthenticationFailed,
    PermissionDenied,
    ValidationError,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts import delegations as delegation_service
from apps.accounts.models import Delegation, User
from apps.accounts.serializers import (
    DelegationSerializer,
    DelegationWriteSerializer,
    LoginSerializer,
    UserSerializer,
)


class LoginView(APIView):
    """POST /api/auth/login/ -> { token, user }."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = authenticate(
            request,
            username=serializer.validated_data["username"],
            password=serializer.validated_data["password"],
        )
        if user is None:
            raise AuthenticationFailed("Invalid username or password.")

        token, _ = Token.objects.get_or_create(user=user)
        return Response(
            {"token": token.key, "user": UserSerializer(user).data},
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    """POST /api/auth/logout/ -> 204; deletes the caller's token."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if isinstance(request.auth, Token):
            request.auth.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    """GET /api/auth/me/ -> the authenticated User."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class DelegationQuerysetMixin:
    def get_queryset(self):
        queryset = Delegation.objects.select_related(
            "principal", "delegate"
        ).order_by("-starts_at")
        user = self.request.user
        if user.role in (User.Role.CONTROLLER, User.Role.AUDITOR):
            return queryset
        return queryset.filter(
            Q(principal=user) | Q(delegate=user)
        ).distinct()


class DelegationListView(DelegationQuerysetMixin, generics.ListCreateAPIView):
    """GET/POST /api/delegations/ (contract §7.3)."""

    permission_classes = [IsAuthenticated]
    serializer_class = DelegationSerializer

    def post(self, request):
        user = request.user
        if user.role == User.Role.AUDITOR:
            raise PermissionDenied("Auditors cannot create delegations.")
        if user.role not in delegation_service.DELEGABLE_ROLES:
            raise PermissionDenied(
                "This role cannot create delegations."
            )
        if not user.is_active or user.status != User.Status.ACTIVE:
            raise PermissionDenied(
                "Only active users can create delegations."
            )

        serializer = DelegationWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        principal = user
        principal_id = data.get("principal_id")
        if principal_id and principal_id != user.user_id:
            if user.role != User.Role.CONTROLLER:
                raise PermissionDenied(
                    "Only a Controller can delegate for another user."
                )
            principal = User.objects.filter(user_id=principal_id).first()
            if principal is None:
                raise ValidationError(
                    {"principal_id": "Unknown user."}
                )

        delegate = User.objects.filter(
            user_id=data.get("delegate_id")
        ).first()
        if delegate is None:
            raise ValidationError({"delegate_id": "Unknown user."})

        try:
            delegation = delegation_service.create_delegation(
                principal,
                delegate,
                starts_at=data.get("starts_at"),
                ends_at=data.get("ends_at"),
                actor=user,
            )
        except delegation_service.DelegationValidationError as exc:
            raise ValidationError({"detail": exc.message}) from exc

        return Response(
            DelegationSerializer(delegation).data,
            status=status.HTTP_201_CREATED,
        )


class DelegationDetailView(
    DelegationQuerysetMixin, generics.RetrieveDestroyAPIView
):
    """GET/DELETE /api/delegations/{id}/."""

    permission_classes = [IsAuthenticated]
    serializer_class = DelegationSerializer
    lookup_field = "delegation_id"
    lookup_url_kwarg = "delegation_id"
    http_method_names = ["get", "delete"]

    def delete(self, request, *args, **kwargs):
        delegation = self.get_object()
        user = request.user
        if user.role == User.Role.AUDITOR:
            raise PermissionDenied("Auditors cannot end delegations.")
        if (
            user.role != User.Role.CONTROLLER
            and delegation.principal_id != user.id
        ):
            raise PermissionDenied(
                "Only the principal or a Controller can end a delegation."
            )
        if not user.is_active or user.status != User.Status.ACTIVE:
            raise PermissionDenied(
                "Only active users can end delegations."
            )
        delegation_service.end_delegation(delegation, actor=user)
        return Response(status=status.HTTP_204_NO_CONTENT)
