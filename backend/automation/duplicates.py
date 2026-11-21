from decimal import Decimal, InvalidOperation


def detect_duplicates(invoice_data: dict, historical_invoices: list) -> list:
    """Detect invoices with the same vendor and invoice number."""
    findings = []

    vendor = str(invoice_data.get("vendor_name") or "").strip().casefold()
    invoice_number = str(invoice_data.get("invoice_number") or "").strip().casefold()

    if not vendor or not invoice_number:
        return findings

    for historical in historical_invoices:
        old_vendor = str(historical.get("vendor_name") or "").strip().casefold()
        old_number = str(historical.get("invoice_number") or "").strip().casefold()

        if vendor == old_vendor and invoice_number == old_number:
            findings.append({
                "code": "POSSIBLE_DUPLICATE",
                "severity": "BLOCK",
                "message": "An invoice with the same vendor and invoice number already exists.",
                "evidence": {
                    "matching_invoice_id": historical.get("invoice_id")
                }
            })

    return findings