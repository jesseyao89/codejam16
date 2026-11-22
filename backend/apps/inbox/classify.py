"""Deterministic email/attachment classification (no AI required)."""

from pathlib import Path

INVOICE_HINTS = ("invoice", "facture", "factura", "bill")
ATTACHMENT_CLAIMS = (
    "attached",
    "ci-joint",
    "find attached",
    "please find",
    "enclosed",
)

_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


def content_type_for(filename: str) -> str:
    return _CONTENT_TYPES.get(Path(filename).suffix.lower(), "application/octet-stream")


def classify(subject: str, body: str, attachments: list[str]) -> tuple[str, str]:
    """Return ``(classification, confidence)`` for an email."""
    text = f"{subject}\n{body}".casefold()
    invoice_word = any(hint in text for hint in INVOICE_HINTS)
    filename_hint = any(
        "invoice" in name.casefold() or "facture" in name.casefold()
        for name in attachments
    )

    if attachments:
        if invoice_word or filename_hint:
            return "INVOICE", "0.95"
        return "UNCERTAIN", "0.50"

    if invoice_word and any(hint in text for hint in ATTACHMENT_CLAIMS):
        # Claims an invoice/attachment but none is present: route for review.
        return "UNCERTAIN", "0.40"
    return "NOT_INVOICE", "0.90"
