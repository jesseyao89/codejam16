"""Approval endpoints (contract §7)."""

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.approvals import services
from apps.invoices.serializers import ApprovalStepSerializer, InvoiceSerializer

_STATUS_TO_ACTION = {"PENDING": "", "APPROVED": "approved", "REJECTED": "rejected"}
_TRUTHY = {"1", "true", "True", "yes"}


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
        assigned_to_user = (
            Q(approver=user)
            | Q(approver__delegate=user, approver__status="on_leave")
            | Q(approver__isnull=True, approver_role=user.role)
        )
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
