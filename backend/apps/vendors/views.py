from django.db.models import Q, QuerySet
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated

from apps.vendors.models import BankChange, Vendor
from apps.vendors.serializers import BankChangeSerializer, VendorSerializer


class VendorListView(generics.ListAPIView):
    serializer_class = VendorSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self) -> QuerySet[Vendor]:
        queryset = Vendor.objects.order_by("vendor_id")
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


class VendorDetailView(generics.RetrieveAPIView):
    queryset = Vendor.objects.all()
    serializer_class = VendorSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "vendor_id"
    lookup_url_kwarg = "vendor_id"


class VendorBankChangeListView(generics.ListAPIView):
    serializer_class = BankChangeSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self) -> QuerySet[BankChange]:
        vendor = get_object_or_404(Vendor, vendor_id=self.kwargs["vendor_id"])
        return (
            BankChange.objects.filter(vendor=vendor)
            .select_related("vendor", "changed_by")
            .order_by("changed_at", "change_id")
        )
