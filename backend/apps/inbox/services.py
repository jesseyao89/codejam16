"""Inbox orchestration: sync, per-attachment ingest, dismiss (contract §4)."""

from __future__ import annotations

from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.exceptions import InvalidStateTransition
from apps.audit.services import record_audit
from apps.inbox.loader import load_emails
from apps.inbox.models import Email, EmailAttachment
from apps.invoices import actions

_EXTRACTION_ERROR_CODES = {"EXTRACTION_FAILED", "EXTRACTION_UNREADABLE"}


def _attachment_root() -> Path:
    configured = getattr(settings, "INBOX_ATTACHMENT_DIR", None)
    if configured:
        root = Path(configured)
    else:
        root = Path(settings.DATA_DIR) / "incoming_invoices"
    return root.resolve()


def _resolve_attachment(filename: str) -> Path | None:
    root = _attachment_root()
    try:
        candidate = (root / filename).resolve()
    except (OSError, ValueError):
        return None
    if root not in candidate.parents:
        return None
    return candidate if candidate.exists() else None


def _ingest_attachment(attachment: EmailAttachment, actor):
    # Re-lock the row so a concurrent double-click cannot create two drafts.
    attachment = (
        EmailAttachment.objects.select_for_update()
        .select_related("invoice")
        .get(pk=attachment.pk)
    )
    if attachment.invoice_id:
        return attachment.invoice

    path = _resolve_attachment(attachment.filename)
    if path is None:
        invoice = actions.create_invoice_with_extraction_failure(
            actor,
            attachment.filename,
            "Attachment file is missing or unreadable.",
            source="inbox",
            email_id=attachment.email_id,
            code="EXTRACTION_UNREADABLE",
        )
    else:
        invoice = actions.create_invoice_from_path(
            actor,
            path,
            attachment.filename,
            source="inbox",
            email_id=attachment.email_id,
        )

    codes = {finding.get("code") for finding in (invoice.findings or [])}
    attachment.invoice = invoice
    attachment.processed_at = timezone.now()
    if codes & _EXTRACTION_ERROR_CODES:
        attachment.status = EmailAttachment.Status.FAILED
        message = next(
            (
                finding.get("message")
                for finding in (invoice.findings or [])
                if finding.get("code") in _EXTRACTION_ERROR_CODES
            ),
            "Extraction failed.",
        )
        attachment.error = str(message)[:255]
    else:
        attachment.status = EmailAttachment.Status.INGESTED
        attachment.error = ""

    attachment.save(
        update_fields=["invoice", "status", "processed_at", "error"]
    )
    record_audit(
        actor,
        "EMAIL_ATTACHMENT_INGESTED",
        "EMAIL",
        attachment.email_id,
        evidence={
            "attachment": attachment.filename,
            "invoice_id": invoice.invoice_id,
            "status": attachment.status,
        },
    )
    return invoice


def update_email_status(email: Email) -> None:
    attachments = list(email.attachments.all())
    if not attachments:
        email.status = Email.Status.ROUTED
    else:
        processed = [a for a in attachments if a.invoice_id]
        if len(processed) == len(attachments):
            email.status = Email.Status.INGESTED
        elif processed:
            email.status = Email.Status.PARTIAL
        else:
            email.status = Email.Status.NEW

    if email.status in (
        Email.Status.INGESTED,
        Email.Status.PARTIAL,
        Email.Status.ROUTED,
    ):
        email.processed_at = timezone.now()
    email.save(update_fields=["status", "processed_at"])


def ingest_email(email, actor, attachment_filename=None) -> list:
    if email.status == Email.Status.DISMISSED:
        raise InvalidStateTransition("This email was dismissed.")
    if email.classification == Email.Classification.NOT_INVOICE:
        raise InvalidStateTransition("This email is not an invoice.")

    attachments = list(email.attachments.all())
    if attachment_filename:
        attachments = [a for a in attachments if a.filename == attachment_filename]
        if not attachments:
            raise ValidationError("Unknown attachment.")
    if not attachments:
        raise InvalidStateTransition("This email has no attachments.")

    invoices = []
    with transaction.atomic():
        for attachment in attachments:
            invoices.append(_ingest_attachment(attachment, actor))
        # Drop any prefetched attachment cache so the status sees new links.
        email.refresh_from_db()
        update_email_status(email)
    return invoices


def sync_inbox(actor, data_dir=None) -> dict:
    """Reload/classify the source, then finish any unprocessed attachments."""
    load_emails(data_dir or settings.DATA_DIR)
    counts = {"ingested": 0, "skipped": 0, "routed": 0, "failed": 0}

    emails = Email.objects.prefetch_related("attachments__invoice").order_by(
        "email_id"
    )
    try:
        for email in emails:
            try:
                if email.status == Email.Status.DISMISSED:
                    counts["skipped"] += 1
                    continue

                attachments = list(email.attachments.all())
                if not attachments:
                    if email.status != Email.Status.ROUTED:
                        email.status = Email.Status.ROUTED
                        email.processed_at = timezone.now()
                        email.save(update_fields=["status", "processed_at"])
                    counts["routed"] += 1
                    continue

                invoiced = [a for a in attachments if a.invoice_id]
                unprocessed = [a for a in attachments if not a.invoice_id]

                if email.classification != Email.Classification.INVOICE:
                    if invoiced:
                        counts["skipped"] += 1
                    else:
                        if email.status != Email.Status.ROUTED:
                            email.status = Email.Status.ROUTED
                            email.processed_at = timezone.now()
                            email.save(update_fields=["status", "processed_at"])
                        counts["routed"] += 1
                    continue

                if not unprocessed:
                    counts["skipped"] += 1
                    continue

                ingest_email(email, actor)
                counts["ingested"] += 1
            except Exception:  # noqa: BLE001 - one email must not abort the sync
                counts["failed"] += 1
    finally:
        record_audit(actor, "INBOX_SYNCED", "INBOX", "emails", evidence=counts)

    return counts


def dismiss_email(email: Email, actor) -> None:
    with transaction.atomic():
        email.status = Email.Status.DISMISSED
        email.processed_at = timezone.now()
        email.save(update_fields=["status", "processed_at"])
        record_audit(actor, "EMAIL_DISMISSED", "EMAIL", email.email_id)
