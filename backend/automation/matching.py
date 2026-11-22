from decimal import Decimal, InvalidOperation


def _decimal(value):
    if value is None or value == "":
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return parsed if parsed.is_finite() else None


def _truthy(value) -> bool:
    return str(value or "").strip().lower() in ("yes", "true", "1", "y")


def _finding(code, severity, message, evidence):
    return {
        "code": code,
        "severity": severity,
        "message": message,
        "evidence": evidence,
    }


def _prior_spend(invoice_data, po_id, historical_invoices):
    prior = Decimal("0")
    invoice_id = invoice_data.get("invoice_id")
    currency = (invoice_data.get("currency") or "").upper()
    for row in historical_invoices or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("po_id") or "") != po_id:
            continue
        if invoice_id and row.get("invoice_id") == invoice_id:
            continue
        row_currency = (row.get("currency") or "").upper()
        if currency and row_currency and row_currency != currency:
            continue
        amount = _decimal(row.get("total"))
        if amount is not None and amount > 0:
            prior += amount
    return prior


def match_purchase_order(
    invoice_data: dict,
    purchase_orders: list,
    historical_invoices: list | None = None,
) -> list:
    """Compare an invoice against its PO, including cumulative spend."""
    findings = []

    po_id = invoice_data.get("po_id")
    po_reference = invoice_data.get("po_reference")

    if not po_id:
        if po_reference:
            return [
                _finding(
                    "PO_NOT_FOUND",
                    "BLOCK",
                    "Referenced purchase order was not found.",
                    {"po_reference": po_reference},
                )
            ]
        if _truthy(invoice_data.get("vendor_requires_po")):
            total = _decimal(invoice_data.get("total"))
            if total is None or total > 0:
                findings.append(
                    _finding(
                        "PO_REQUIRED_MISSING",
                        "WARNING",
                        "This vendor requires a purchase order, but none was found.",
                        {
                            "vendor_id": invoice_data.get("vendor_id"),
                            "requires_po": invoice_data.get("vendor_requires_po"),
                        },
                    )
                )
        return findings

    matching_po = next(
        (po for po in purchase_orders if po.get("po_id") == po_id), None
    )

    if matching_po is None:
        return [
            _finding(
                "PO_NOT_FOUND",
                "BLOCK",
                "Referenced purchase order was not found.",
                {"po_id": po_id},
            )
        ]

    if (
        invoice_data.get("vendor_id")
        and invoice_data["vendor_id"] != matching_po.get("vendor_id")
    ):
        findings.append(
            _finding(
                "PO_VENDOR_MISMATCH",
                "BLOCK",
                "Invoice vendor does not match purchase order vendor.",
                {
                    "invoice_vendor_id": invoice_data["vendor_id"],
                    "po_vendor_id": matching_po.get("vendor_id"),
                },
            )
        )

    if (
        invoice_data.get("currency")
        and invoice_data["currency"] != matching_po.get("currency")
    ):
        findings.append(
            _finding(
                "PO_CURRENCY_MISMATCH",
                "BLOCK",
                "Invoice currency does not match purchase order currency.",
                {
                    "invoice_currency": invoice_data["currency"],
                    "po_currency": matching_po.get("currency"),
                },
            )
        )

    invoice_total = _decimal(invoice_data.get("total"))
    po_total = _decimal(matching_po.get("total_amount"))
    if invoice_total is None or po_total is None:
        findings.append(
            _finding(
                "PO_AMOUNT_UNVERIFIABLE",
                "WARNING",
                "Could not verify invoice amount against purchase order.",
                {"po_id": po_id},
            )
        )
        return findings

    if invoice_total > 0 and invoice_total > po_total:
        findings.append(
            _finding(
                "PO_AMOUNT_EXCEEDED",
                "BLOCK",
                "Invoice total exceeds purchase order amount.",
                {
                    "invoice_total": str(invoice_total),
                    "po_total": str(po_total),
                    "difference": str(invoice_total - po_total),
                },
            )
        )
    elif invoice_total > 0:
        prior = _prior_spend(invoice_data, po_id, historical_invoices)
        cumulative = prior + invoice_total
        if cumulative > po_total:
            findings.append(
                _finding(
                    "PO_CUMULATIVE_EXCEEDED",
                    "BLOCK",
                    "Invoices linked to this purchase order exceed its total.",
                    {
                        "po_id": po_id,
                        "po_total": str(po_total),
                        "prior_invoiced": str(prior),
                        "current_invoice": str(invoice_total),
                        "cumulative": str(cumulative),
                        "difference": str(cumulative - po_total),
                    },
                )
            )

    return findings
