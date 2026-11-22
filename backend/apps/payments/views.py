"""Payment endpoints (contract §8)."""

from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import role_required
from apps.invoices.actions import visible_invoices
from apps.payments import services
from apps.payments.serializers import PaymentSerializer

_EDIT_ROLES = {"AP_CLERK", "FINANCE_MANAGER", "CONTROLLER"}
_RELEASE_ROLES = {"FINANCE_MANAGER", "CONTROLLER"}

# Canonical query value -> stored values that serialize to it.
_CANONICAL_STATUS_VALUES = {
    "PREPARED": ("PREPARED",),
    "SCHEDULED": ("SCHEDULED", "scheduled", "outstanding"),
    "RELEASED": ("RELEASED",),
    "PAID": ("PAID", "settled"),
    "FAILED": ("FAILED",),
    "CANCELLED": ("CANCELLED",),
}
_LEGACY_STATUS_VALUES = {"settled", "scheduled", "outstanding"}


class PaymentListView(generics.ListAPIView):
    serializer_class = PaymentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = services.payments_visible_to(self.request.user)
        params = self.request.query_params
        if params.get("status"):
            value = params["status"].strip()
            if value in _LEGACY_STATUS_VALUES:
                # Legacy lowercase aliases still match their exact stored rows.
                queryset = queryset.filter(status=value)
            else:
                queryset = queryset.filter(
                    status__in=_CANONICAL_STATUS_VALUES.get(value.upper(), (value,))
                )
        if params.get("invoice_id"):
            queryset = queryset.filter(invoice_id=params["invoice_id"])
        return queryset.select_related(
            "invoice", "vendor", "prepared_by", "released_by"
        ).order_by("payment_id")


class PaymentDetailView(generics.RetrieveAPIView):
    serializer_class = PaymentSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "payment_id"
    lookup_url_kwarg = "payment_id"

    def get_queryset(self):
        return services.payments_visible_to(self.request.user)


class PaymentPrepareView(APIView):
    permission_classes = [role_required(*_EDIT_ROLES)]

    def post(self, request):
        invoice_id = request.data.get("invoice_id")
        if not invoice_id:
            raise ValidationError("invoice_id is required.")
        invoice = get_object_or_404(
            visible_invoices(request.user), invoice_id=invoice_id
        )
        payment = services.prepare_payment(invoice, request.user)
        return Response(
            PaymentSerializer(payment).data, status=status.HTTP_201_CREATED
        )


class PaymentReleaseView(APIView):
    permission_classes = [role_required(*_RELEASE_ROLES)]

    def post(self, request, payment_id):
        payment = get_object_or_404(
            services.payments_visible_to(request.user), payment_id=payment_id
        )
        payment = services.release_payment(payment, request.user)
        return Response(PaymentSerializer(payment).data)


class PaymentCancelView(APIView):
    permission_classes = [role_required(*_EDIT_ROLES)]

    def post(self, request, payment_id):
        payment = get_object_or_404(
            services.payments_visible_to(request.user), payment_id=payment_id
        )
        payment = services.cancel_payment(payment, request.user)
        return Response(PaymentSerializer(payment).data)
