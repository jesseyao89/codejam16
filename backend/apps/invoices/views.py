"""Views for reference data and invoices (contract §3, §4, §5)."""

from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Department
from apps.accounts.permissions import role_required
from apps.invoices import actions
from apps.invoices.models import GLAccount, TaxCode
from apps.invoices.serializers import (
    ApprovalStepSerializer,
    GLAccountSerializer,
    InvoiceSerializer,
    ReferenceDepartmentSerializer,
    TaxCodeSerializer,
)

_EDIT_ROLES = {"AP_CLERK", "FINANCE_MANAGER", "CONTROLLER"}


# --- Reference data ---------------------------------------------------------


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


# --- Invoices ---------------------------------------------------------------


def _filter_invoices(queryset, params):
    if params.get("status"):
        queryset = queryset.filter(status=params["status"])
    if params.get("vendor_id"):
        queryset = queryset.filter(vendor_id=params["vendor_id"])
    if params.get("department_id"):
        queryset = queryset.filter(department_id=params["department_id"])
    if params.get("requester_id"):
        queryset = queryset.filter(requester__user_id=params["requester_id"])
    if params.get("validation_status"):
        queryset = queryset.filter(validation_status=params["validation_status"])
    if params.get("q"):
        query = params["q"]
        queryset = queryset.filter(
            vendor__legal_name__icontains=query
        ) | queryset.filter(vendor_invoice_number__icontains=query)
    return queryset


class InvoiceListView(generics.ListAPIView):
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = actions.visible_invoices(self.request.user)
        return _filter_invoices(queryset, self.request.query_params).order_by(
            "invoice_id"
        )


class InvoiceDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "patch"]
    lookup_field = "invoice_id"
    lookup_url_kwarg = "invoice_id"

    def get_queryset(self):
        return actions.visible_invoices(self.request.user)

    def patch(self, request, *args, **kwargs):
        if request.user.role not in _EDIT_ROLES:
            raise PermissionDenied("Your role cannot edit invoices.")
        invoice = self.get_object()
        invoice = actions.apply_invoice_patch(invoice, request.data, request.user)
        return Response(InvoiceSerializer(invoice).data)


class DashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        summary = actions.dashboard_summary(request.user)
        summary["pending_approvals"] = ApprovalStepSerializer(
            summary["pending_approvals"], many=True
        ).data
        return Response(summary)


class InvoiceActionView(APIView):
    permission_classes = [role_required(*_EDIT_ROLES)]

    def get_invoice(self, request, invoice_id):
        return get_object_or_404(
            actions.visible_invoices(request.user), invoice_id=invoice_id
        )


class InvoiceUploadView(APIView):
    permission_classes = [role_required(*_EDIT_ROLES)]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        file = request.FILES.get("file")
        if file is None:
            raise ValidationError("A file is required (multipart field 'file').")
        invoice = actions.create_invoice_from_upload(request.user, file)
        return Response(InvoiceSerializer(invoice).data, status=status.HTTP_201_CREATED)


class InvoiceAnalyzeView(InvoiceActionView):
    def post(self, request, invoice_id):
        invoice = self.get_invoice(request, invoice_id)
        return Response(actions.run_analysis(invoice))


class InvoiceResolveFindingView(InvoiceActionView):
    def post(self, request, invoice_id):
        invoice = self.get_invoice(request, invoice_id)
        finding_id = request.data.get("finding_id")
        justification = request.data.get("justification") or ""
        if not finding_id:
            raise ValidationError("finding_id is required.")
        invoice = actions.resolve_finding(
            invoice, finding_id, justification, request.user
        )
        return Response(InvoiceSerializer(invoice).data)


class InvoiceSubmitView(InvoiceActionView):
    def post(self, request, invoice_id):
        invoice = self.get_invoice(request, invoice_id)
        invoice = actions.submit_invoice(invoice, request.user)
        return Response(InvoiceSerializer(invoice).data)
