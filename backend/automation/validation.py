from decimal import Decimal, InvalidOperation


def validate_invoice(invoice_data: dict) -> list:
    """Check an invoice for missing information and incorrect totals."""

    findings = []

    # 1. Check required fields
    required_fields = [
        "invoice_number",
        "invoice_date",
        "currency",
        "total",
    ]

    # Require at least one vendor identifier
    if not invoice_data.get("vendor_name") and not invoice_data.get("vendor_id"):
        findings.append({
            "code": "MISSING_FIELD",
            "severity": "BLOCK",
            "message": "Missing vendor name or vendor ID.",
            "evidence": {"field": "vendor_name/vendor_id"}
        })

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

            tax_lines = invoice_data.get("tax_lines")
            if isinstance(tax_lines, list) and tax_lines:
                tax_total = Decimal("0")
                for line in tax_lines:
                    if not isinstance(line, dict):
                        continue
                    amount = line.get("amount")
                    if amount in (None, ""):
                        continue
                    tax_total += Decimal(str(amount))
            else:
                tax_total = Decimal(str(invoice_data.get("gst_hst") or "0")) + Decimal(
                    str(invoice_data.get("pst_qst") or "0")
                )

            expected_total = subtotal + tax_total

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

        except (InvalidOperation, TypeError, ValueError):
            findings.append({
                "code": "INVALID_AMOUNT",
                "severity": "BLOCK",
                "message": "One or more invoice amounts are invalid.",
                "evidence": {}
            })

    return findings