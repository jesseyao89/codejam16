"""Approval and policy endpoints (contract §7)."""

from collections.abc import Mapping
from uuid import uuid4

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.delegations import principals_for_delegate
from apps.accounts.permissions import role_required
from apps.approvals import services
from apps.approvals.models import ApprovalPolicy
from apps.approvals.serializers import PolicySerializer, PolicyWriteSerializer
from apps.audit.services import record_audit
from apps.invoices.serializers import ApprovalStepSerializer, InvoiceSerializer

_STATUS_TO_ACTION = {"PENDING": "", "APPROVED": "approved", "REJECTED": "rejected"}
_TRUTHY = {"1", "true", "True", "yes"}
_FALSEY = {"0", "false", "False", "no"}
_POLICY_WRITE_ROLES = {"CONTROLLER"}
_POLICY_READ_ROLES = {"CONTROLLER", "AUDITOR"}


class ApprovalListView(generics.ListAPIView):
    serializer_class = ApprovalStepSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = services.approvals_visible_to(self.request.user)
        params = self.request.query_params

        if params.get("invoice_id"):
            queryset = queryset.filter(invoice_id=params["invoice_id"])
        if params.get("status"):
            queryset = queryset.filter(
                action=_STATUS_TO_ACTION.get(params["status"], params["status"])
            )
        user = self.request.user
        actionable_user = user.is_active and user.status == "active"
        assigned_to_user = Q(pk__in=[])
        if actionable_user:
            principal_ids = principals_for_delegate(user)
            assigned_to_user = (
                Q(approver=user)
                | Q(approver__isnull=True, approver_role=user.role)
            )
            if principal_ids:
                assigned_to_user |= Q(approver_id__in=principal_ids)
        if params.get("mine") in _TRUTHY or params.get("actionable") in _TRUTHY:
            queryset = queryset.filter(assigned_to_user)
        if params.get("actionable") in _TRUTHY:
            queryset = queryset.filter(
                action="", invoice__status="PENDING_APPROVAL"
            )

        return queryset.select_related("approver", "invoice", "delegated_for").order_by(
            "invoice_id", "step_no"
        )


class ApprovalDetailView(generics.RetrieveAPIView):
    serializer_class = ApprovalStepSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "approval_id"
    lookup_url_kwarg = "approval_id"

    def get_queryset(self):
        return services.approvals_visible_to(self.request.user)


class ApprovalActionView(APIView):
    permission_classes = [IsAuthenticated]

    def get_step(self, request, approval_id):
        return get_object_or_404(
            services.approvals_visible_to(request.user), approval_id=approval_id
        )


class ApprovalApproveView(ApprovalActionView):
    def post(self, request, approval_id):
        step = self.get_step(request, approval_id)
        invoice = services.approve(
            step, request.user, request.data.get("comment") or ""
        )
        return Response(InvoiceSerializer(invoice).data)


class ApprovalRejectView(ApprovalActionView):
    def post(self, request, approval_id):
        step = self.get_step(request, approval_id)
        invoice = services.reject(
            step, request.user, request.data.get("comment") or ""
        )
        return Response(InvoiceSerializer(invoice).data)


# --- Policies (contract §7.2) ----------------------------------------------


class PolicyListView(generics.ListAPIView):
    serializer_class = PolicySerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [role_required(*_POLICY_WRITE_ROLES)()]
        return [role_required(*_POLICY_READ_ROLES, allow_on_leave=True)()]

    def get_queryset(self):
        queryset = ApprovalPolicy.objects.order_by("priority", "rule_id")
        active = self.request.query_params.get("active")
        if active in _TRUTHY:
            queryset = queryset.filter(active=True)
        elif active in _FALSEY:
            queryset = queryset.filter(active=False)
        return queryset

    def post(self, request):
        if not isinstance(request.data, Mapping):
            raise ValidationError("Expected a JSON object.")
        serializer = PolicyWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            policy = ApprovalPolicy.objects.create(
                rule_id=f"POL-{uuid4().hex[:8].upper()}",
                rule_type="approval",
                name=data["name"],
                priority=data.get("priority", 100),
                active=data.get("active", True),
                conditions=data.get("conditions") or {},
                steps=data.get("steps") or [],
            )
            record_audit(
                request.user,
                "POLICY_CREATED",
                "POLICY",
                policy.rule_id,
                after={
                    "name": policy.name,
                    "priority": policy.priority,
                    "active": policy.active,
                    "conditions": policy.conditions,
                    "steps": policy.steps,
                },
            )
        return Response(
            PolicySerializer(policy).data, status=status.HTTP_201_CREATED
        )


class PolicyDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PolicySerializer
    lookup_field = "rule_id"
    lookup_url_kwarg = "rule_id"
    http_method_names = ["get", "patch", "delete"]

    def get_permissions(self):
        if self.request.method in {"PATCH", "DELETE"}:
            return [role_required(*_POLICY_WRITE_ROLES)()]
        return [role_required(*_POLICY_READ_ROLES, allow_on_leave=True)()]

    def get_queryset(self):
        return ApprovalPolicy.objects.all()

    def patch(self, request, *args, **kwargs):
        if not isinstance(request.data, Mapping):
            raise ValidationError("Expected a JSON object.")

        policy = self.get_object()
        if not request.data:
            raise ValidationError("No fields to update.")

        serializer = PolicyWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            policy = ApprovalPolicy.objects.select_for_update().get(
                pk=policy.pk
            )
            before = {
                "name": policy.name,
                "priority": policy.priority,
                "active": policy.active,
                "conditions": policy.conditions,
                "steps": policy.steps,
            }
            if "name" in data:
                policy.name = data["name"]
            if "priority" in data:
                policy.priority = data["priority"]
            if "active" in data:
                policy.active = data["active"]
            if "conditions" in data:
                policy.conditions = data["conditions"] or {}
            if "steps" in data:
                policy.steps = data["steps"]

            if policy.active and not policy.steps:
                raise ValidationError(
                    {"steps": "An active policy requires at least one step."}
                )

            policy.save()
            record_audit(
                request.user,
                "POLICY_UPDATED",
                "POLICY",
                policy.rule_id,
                before=before,
                after={
                    "name": policy.name,
                    "priority": policy.priority,
                    "active": policy.active,
                    "conditions": policy.conditions,
                    "steps": policy.steps,
                },
            )
        return Response(PolicySerializer(policy).data)

    def destroy(self, request, *args, **kwargs):
        policy = self.get_object()
        with transaction.atomic():
            policy = ApprovalPolicy.objects.select_for_update().get(
                pk=policy.pk
            )
            was_active = policy.active
            if was_active:
                policy.active = False
                policy.save(update_fields=["active"])
            record_audit(
                request.user,
                "POLICY_ARCHIVED",
                "POLICY",
                policy.rule_id,
                before={"active": was_active},
                after={"active": False},
                evidence={"already_inactive": not was_active},
            )
        return Response(status=status.HTTP_204_NO_CONTENT)
