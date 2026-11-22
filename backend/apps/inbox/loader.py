"""Load ``inbox/emails.json`` into the Email/EmailAttachment tables (idempotent).

One malformed row must never abort the dataset load (AGENTS.md §1): each row is
parsed defensively and reported instead.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone as dt_timezone
from pathlib import Path

from django.utils import timezone

from apps.inbox.classify import classify, content_type_for
from apps.inbox.models import Email, EmailAttachment


def _aware(value):
    if value in (None, ""):
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=dt_timezone.utc)
    return parsed


def _attachment_names(value) -> list[str]:
    names = []
    for item in value or []:
        if isinstance(item, dict):
            name = item.get("filename") or item.get("name")
        else:
            name = item
        if name is None:
            continue
        name = str(name).strip()
        if name:
            names.append(name)
    return names


def load_emails(data_dir, errors: list | None = None) -> int:
    path = Path(data_dir) / "inbox" / "emails.json"
    if not path.exists():
        return 0

    try:
        with path.open(encoding="utf-8-sig") as handle:
            rows = json.load(handle)
    except (OSError, ValueError) as exc:
        if errors is not None:
            errors.append(("inbox", str(path), f"cannot read inbox: {exc}"[:200]))
        return 0

    if not isinstance(rows, list):
        if errors is not None:
            errors.append(("inbox", str(path), "emails.json must be a list"))
        return 0

    count = 0
    for row in rows:
        try:
            if not isinstance(row, dict):
                raise ValueError("email row is not an object")

            email_id = str(row.get("email_id") or "").strip()
            if not email_id:
                raise ValueError("missing email_id")

            attachments = _attachment_names(row.get("attachments"))
            classification, confidence = classify(
                str(row.get("subject") or ""),
                str(row.get("body") or ""),
                attachments,
            )

            email, created = Email.objects.update_or_create(
                email_id=email_id,
                defaults={
                    "sender": str(row.get("from_address") or ""),
                    "from_name": str(row.get("from_name") or ""),
                    "to_address": str(row.get("to_address") or ""),
                    "subject": str(row.get("subject") or ""),
                    "received_at": _aware(row.get("received_at")),
                    "body": str(row.get("body") or ""),
                    "classification": classification,
                    "classification_confidence": confidence,
                },
            )

            if created and classification != Email.Classification.INVOICE:
                email.status = Email.Status.ROUTED
                email.processed_at = timezone.now()
                email.save(update_fields=["status", "processed_at"])
            elif (
                not created
                and email.status == Email.Status.ROUTED
                and classification == Email.Classification.INVOICE
            ):
                email.status = Email.Status.NEW
                email.processed_at = None
                email.save(update_fields=["status", "processed_at"])

            for order, filename in enumerate(attachments):
                EmailAttachment.objects.get_or_create(
                    email=email,
                    filename=filename,
                    defaults={
                        "order": order,
                        "content_type": content_type_for(filename),
                    },
                )
            count += 1
        except Exception as exc:  # noqa: BLE001 - one bad row must not abort the load
            if errors is not None:
                key = str(row.get("email_id")) if isinstance(row, dict) else "?"
                errors.append(("inbox", key, str(exc)[:200]))
            continue

    return count
