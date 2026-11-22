"""Inbox endpoints (contract §4)."""

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import role_required
from apps.inbox import services
from apps.inbox.models import Email
from apps.inbox.serializers import EmailSerializer
from apps.invoices.serializers import InvoiceSerializer

_READ_ROLES = {"AP_CLERK", "FINANCE_MANAGER", "CONTROLLER", "AUDITOR"}
_WRITE_ROLES = {"AP_CLERK", "FINANCE_MANAGER", "CONTROLLER"}


class InboxListView(generics.ListAPIView):
    serializer_class = EmailSerializer
    permission_classes = [role_required(*_READ_ROLES)]

    def get_queryset(self):
        queryset = Email.objects.prefetch_related("attachments__invoice").order_by(
            "-received_at", "email_id"
        )
        params = self.request.query_params
        if params.get("classification"):
            queryset = queryset.filter(classification=params["classification"])
        if params.get("status"):
            queryset = queryset.filter(status=params["status"])
        if params.get("q"):
            query = params["q"]
            queryset = queryset.filter(
                Q(subject__icontains=query) | Q(sender__icontains=query)
            )
        return queryset


class InboxDetailView(generics.RetrieveAPIView):
    serializer_class = EmailSerializer
    permission_classes = [role_required(*_READ_ROLES)]
    lookup_field = "email_id"
    lookup_url_kwarg = "email_id"
    queryset = Email.objects.prefetch_related("attachments__invoice")


class InboxSyncView(APIView):
    permission_classes = [role_required(*_WRITE_ROLES)]

    def post(self, request):
        return Response(services.sync_inbox(request.user))


class InboxIngestView(APIView):
    permission_classes = [role_required(*_WRITE_ROLES)]

    def post(self, request, email_id):
        email = get_object_or_404(
            Email.objects.prefetch_related("attachments__invoice"),
            email_id=email_id,
        )
        attachment = request.data.get("attachment")
        invoices = services.ingest_email(email, request.user, attachment)
        email.refresh_from_db()
        return Response(
            {
                "email": EmailSerializer(email).data,
                "invoices": InvoiceSerializer(invoices, many=True).data,
            },
            status=status.HTTP_200_OK,
        )


class InboxDismissView(APIView):
    permission_classes = [role_required(*_WRITE_ROLES)]

    def post(self, request, email_id):
        email = get_object_or_404(Email, email_id=email_id)
        services.dismiss_email(email, request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)
