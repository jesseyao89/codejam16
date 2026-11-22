"""Vendor master and controlled bank-change endpoints (contract §6)."""

from django.db.models import Prefetch, Q, QuerySet
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import role_required
from apps.vendors import services
from apps.vendors.models import BankChange, Vendor
from apps.vendors.serializers import (
    BankChangeRequestSerializer,
    BankChangeSerializer,
    VendorSerializer,
    VendorWriteSerializer,
)

_FINANCE_ROLES = {"FINANCE_MANAGER", "CONTROLLER"}
_REQUEST_ROLES = {"AP_CLERK", "FINANCE_MANAGER", "CONTROLLER"}
_READ_ROLES = {"AP_CLERK", "FINANCE_MANAGER", "CONTROLLER", "AUDITOR"}


def _pending_bank_changes() -> Prefetch:
    return Prefetch(
        "bank_changes",
        queryset=BankChange.objects.filter(
            status=BankChange.Status.PENDING
        ).order_by("-changed_at"),
        to_attr="pending_changes",
    )


class VendorListView(generics.ListAPIView):
    serializer_class = VendorSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [role_required(*_FINANCE_ROLES)()]
        return [IsAuthenticated()]

    def get_queryset(self) -> QuerySet[Vendor]:
        queryset = Vendor.objects.prefetch_related(_pending_bank_changes()).order_by(
            "vendor_id"
        )
        status = self.request.query_params.get("status")
        category = self.request.query_params.get("category")
        search = self.request.query_params.get("q")
        if status:
            queryset = queryset.filter(status=status)
        if category:
            queryset = queryset.filter(category=category)
        if search:
            queryset = queryset.filter(
                Q(legal_name__icontains=search) | Q(category__icontains=search)
            )
        return queryset

    def post(self, request):
        serializer = VendorWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vendor = services.create_vendor(request.user, serializer.validated_data)
        return Response(
            VendorSerializer(vendor).data, status=status.HTTP_201_CREATED
        )


class VendorDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = VendorSerializer
    http_method_names = ["get", "patch"]
    lookup_field = "vendor_id"
    lookup_url_kwarg = "vendor_id"

    def get_permissions(self):
        if self.request.method == "PATCH":
            return [role_required(*_FINANCE_ROLES)()]
        return [IsAuthenticated()]

    def get_queryset(self) -> QuerySet[Vendor]:
        return Vendor.objects.prefetch_related(_pending_bank_changes())

    def patch(self, request, *args, **kwargs):
        vendor = self.get_object()
        serializer = VendorWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        vendor = services.update_vendor(
            vendor, serializer.validated_data, request.user
        )
        return Response(VendorSerializer(vendor).data)


class VendorApproveView(APIView):
    permission_classes = [role_required(*_FINANCE_ROLES)]

    def post(self, request, vendor_id):
        vendor = get_object_or_404(Vendor, vendor_id=vendor_id)
        vendor = services.approve_vendor(vendor, request.user)
        return Response(VendorSerializer(vendor).data)


class VendorHoldView(APIView):
    permission_classes = [role_required(*_FINANCE_ROLES)]

    def post(self, request, vendor_id):
        vendor = get_object_or_404(Vendor, vendor_id=vendor_id)
        vendor = services.hold_vendor(vendor, request.user)
        return Response(VendorSerializer(vendor).data)


class VendorUnholdView(APIView):
    permission_classes = [role_required(*_FINANCE_ROLES)]

    def post(self, request, vendor_id):
        vendor = get_object_or_404(Vendor, vendor_id=vendor_id)
        vendor = services.unhold_vendor(vendor, request.user)
        return Response(VendorSerializer(vendor).data)


class VendorBankChangeListView(generics.ListAPIView):
    serializer_class = BankChangeSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [role_required(*_REQUEST_ROLES)()]
        return [role_required(*_READ_ROLES, allow_on_leave=True)()]

    def get_queryset(self) -> QuerySet[BankChange]:
        vendor = get_object_or_404(Vendor, vendor_id=self.kwargs["vendor_id"])
        return (
            BankChange.objects.filter(vendor=vendor)
            .select_related("vendor", "changed_by", "decided_by")
            .order_by("-changed_at", "-change_id")
        )

    def post(self, request, vendor_id):
        vendor = get_object_or_404(Vendor, vendor_id=vendor_id)
        serializer = BankChangeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        change = services.request_bank_change(
            vendor,
            serializer.validated_data["bank_account"],
            serializer.validated_data.get("note", ""),
            request.user,
        )
        return Response(
            BankChangeSerializer(change).data, status=status.HTTP_201_CREATED
        )


class VendorBankChangeApproveView(APIView):
    permission_classes = [role_required(*_FINANCE_ROLES)]

    def post(self, request, vendor_id, change_id):
        change = get_object_or_404(
            BankChange, change_id=change_id, vendor__vendor_id=vendor_id
        )
        change = services.decide_bank_change(change, request.user, approve=True)
        return Response(BankChangeSerializer(change).data)


class VendorBankChangeRejectView(APIView):
    permission_classes = [role_required(*_FINANCE_ROLES)]

    def post(self, request, vendor_id, change_id):
        change = get_object_or_404(
            BankChange, change_id=change_id, vendor__vendor_id=vendor_id
        )
        change = services.decide_bank_change(change, request.user, approve=False)
        return Response(BankChangeSerializer(change).data)
