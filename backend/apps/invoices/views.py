from rest_framework import generics
from rest_framework.permissions import IsAuthenticated

from apps.accounts.models import Department
from apps.invoices.models import GLAccount, TaxCode
from apps.invoices.serializers import (
    GLAccountSerializer,
    ReferenceDepartmentSerializer,
    TaxCodeSerializer,
)


class DepartmentListView(generics.ListAPIView):
    queryset = Department.objects.select_related("manager").order_by("department_id")
    serializer_class = ReferenceDepartmentSerializer
    permission_classes = [IsAuthenticated]


class GLAccountListView(generics.ListAPIView):
    serializer_class = GLAccountSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = GLAccount.objects.order_by("account_number")
        account_type = self.request.query_params.get("account_type")
        if account_type:
            queryset = queryset.filter(account_type=account_type)
        return queryset


class TaxCodeListView(generics.ListAPIView):
    queryset = TaxCode.objects.order_by("code")
    serializer_class = TaxCodeSerializer
    permission_classes = [IsAuthenticated]
