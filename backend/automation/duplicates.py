"""Duplicate invoice detection (exact, reformatted and near matches).

Pure functions, no Django imports (AGENTS.md §4 boundary). Thresholds are
deterministic constants, never model output.

Finding codes and severities follow docs/API_CONTRACT.md §4.3:

- ``EXACT_DUPLICATE``     same vendor + same invoice number once formatting is
                          removed (``BLOCK``).
- ``POSSIBLE_DUPLICATE``  different number but same vendor, amount and currency
                          within a short date window (``WARNING``).
"""

from datetime import date
from decimal import Decimal, InvalidOperation

# A near duplicate must fall within this many days of the candidate.
NEAR_DATE_WINDOW_DAYS = 7
CARD_DATE_WINDOW_DAYS = 90


def _normalize_vendor(value) -> str:
    return str(value or "").strip().casefold()


def _normalize_number(value) -> str:
    """Collapse formatting so ``INV-100``, ``inv 100`` and ``INV100`` match."""
    return "".join(ch for ch in str(value or "").casefold() if ch.isalnum())


def _raw_number(value) -> str:
    return str(value or "").strip().casefold()


def _to_decimal(value):
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _to_date(value):
    try:
        return date.fromisoformat(str(value)[:10])
    except (ValueError, TypeError):
        return None


def _vendor_key(record: dict) -> str:
    return _normalize_vendor(record.get("vendor_id") or record.get("vendor_name"))


def _number_value(record: dict) -> str:
    return record.get("invoice_number") or record.get("vendor_invoice_number")


def _number_key(record: dict) -> str:
    return _normalize_number(_number_value(record))


def _raw_number_key(record: dict) -> str:
    return _raw_number(_number_value(record))


def _payment_evidence(historical: dict) -> dict:
    """Surface card payment when the reference row carries it.

    The historical invoice row may not include payment data; we only report what
    is present and never invent it.
    """
    method = historical.get("payment_method") or historical.get("paid_by")
    return {"paid_by": method} if method else {}


def _finding(code: str, severity: str, message: str, evidence: dict) -> dict:
    return {
        "code": code,
        "severity": severity,
        "message": message,
        "evidence": evidence,
    }


def detect_duplicates(invoice_data: dict, historical_invoices: list) -> list:
    """Return duplicate findings for ``invoice_data`` against history."""

    findings = []

    vendor = _vendor_key(invoice_data)
    if not vendor:
        return findings

    number = _number_key(invoice_data)
    raw_number = _raw_number_key(invoice_data)
    total = _to_decimal(invoice_data.get("total"))
    invoice_date = _to_date(invoice_data.get("invoice_date"))
    currency = str(invoice_data.get("currency") or "").strip().upper()

    for historical in historical_invoices:
        if _vendor_key(historical) != vendor:
            continue

        old_id = historical.get("invoice_id")
        old_number = _number_key(historical)
        old_raw_number = _raw_number_key(historical)

        # Exact or reformatted: the number is equal after removing case,
        # spaces and punctuation.
        if number and old_number and number == old_number:
            match_type = "EXACT" if raw_number == old_raw_number else "REFORMATTED"
            findings.append(
                _finding(
                    code="EXACT_DUPLICATE",
                    severity="BLOCK",
                    message=(
                        "An invoice with the same vendor and invoice number "
                        "already exists."
                    ),
                    evidence={
                        "matching_invoice_id": old_id,
                        "match_type": match_type,
                        **_payment_evidence(historical),
                    },
                )
            )
            continue

        # Near: different number, but same vendor, amount and currency within a
        # short date window.
        old_total = _to_decimal(historical.get("total"))
        old_date = _to_date(historical.get("invoice_date"))
        old_currency = str(historical.get("currency") or "").strip().upper()

        amounts_match = (
            total is not None and old_total is not None and total == old_total
        )
        currencies_match = (
            not currency or not old_currency or currency == old_currency
        )
        dates_close = (
            invoice_date is not None
            and old_date is not None
            and abs((invoice_date - old_date).days) <= NEAR_DATE_WINDOW_DAYS
        )

        if amounts_match and currencies_match and dates_close:
            findings.append(
                _finding(
                    code="POSSIBLE_DUPLICATE",
                    severity="WARNING",
                    message=(
                        "A similar invoice from this vendor with the same "
                        "amount exists within the date window."
                    ),
                    evidence={
                        "matching_invoice_id": old_id,
                        "match_type": "NEAR",
                        "matching_invoice_date": str(old_date),
                        "days_apart": abs((invoice_date - old_date).days),
                        **_payment_evidence(historical),
                    },
                )
            )
            continue

        # A card-paid historical invoice with the same vendor + amount inside a
        # wider window is still a likely repeat, even when the number differs.
        if (
            amounts_match
            and currencies_match
            and str(historical.get("payment_method") or "").upper() == "CARD"
            and invoice_date is not None
            and old_date is not None
            and abs((invoice_date - old_date).days) <= CARD_DATE_WINDOW_DAYS
        ):
            findings.append(
                _finding(
                    code="CARD_INVOICE",
                    severity="WARNING",
                    message=(
                        "This vendor and amount were already paid by card "
                        "within the card duplicate window."
                    ),
                    evidence={
                        "matching_invoice_id": old_id,
                        "match_type": "CARD",
                        "matching_invoice_date": str(old_date),
                        "days_apart": abs((invoice_date - old_date).days),
                        **_payment_evidence(historical),
                    },
                )
            )

    return findings
