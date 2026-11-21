from decimal import Decimal, InvalidOperation


def validate_invoice(invoice_data: dict) -> list:
    """Check an invoice for missing information and incorrect totals."""

    findings = []

    # 1. Check required fields
    required_fields = [
        "vendor_name",
        "invoice_number",
        "invoice_date",
        "currency",
        "total",
    ]

    for field in required_fields:
        if not invoice_data.get(field):
            findings.append({
                "code": "MISSING_FIELD",
                "severity": "BLOCK",
                "message": f"Missing required field: {field}",
                "evidence": {"field": field}
            })

    # 2. Check invoice total
    subtotal = invoice_data.get("subtotal")
    total = invoice_data.get("total")

    if subtotal is not None and total is not None:
        try:
            subtotal = Decimal(str(subtotal))
            total = Decimal(str(total))

            gst = Decimal(str(invoice_data.get("gst_hst") or "0"))
            pst = Decimal(str(invoice_data.get("pst_qst") or "0"))

            expected_total = subtotal + gst + pst

            if abs(expected_total - total) > Decimal("0.02"):
                findings.append({
                    "code": "TOTAL_MISMATCH",
                    "severity": "BLOCK",
                    "message": "Invoice total does not match subtotal plus taxes.",
                    "evidence": {
                        "expected_total": str(expected_total),
                        "actual_total": str(total)
                    }
                })

        except InvalidOperation:
            findings.append({
                "code": "INVALID_AMOUNT",
                "severity": "BLOCK",
                "message": "One or more invoice amounts are invalid.",
                "evidence": {}
            })

    return findings