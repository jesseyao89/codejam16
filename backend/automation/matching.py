from decimal import Decimal, InvalidOperation


def match_purchase_order(invoice_data: dict, purchase_orders: list) -> list:
    """
    Compare an invoice against its referenced purchase order.
    Return findings for discrepancies.
    """

    findings = []

    po_id = invoice_data.get("po_id")

    # No PO reference: cannot perform PO matching.
    if not po_id:
        return findings

    matching_po = next(
        (po for po in purchase_orders if po.get("po_id") == po_id),
        None
    )

    if matching_po is None:
        return [{
            "code": "PO_NOT_FOUND",
            "severity": "BLOCK",
            "message": "Referenced purchase order was not found.",
            "evidence": {"po_id": po_id}
        }]

    # Check vendor.
    if (
        invoice_data.get("vendor_id")
        and invoice_data["vendor_id"] != matching_po.get("vendor_id")
    ):
        findings.append({
            "code": "PO_VENDOR_MISMATCH",
            "severity": "BLOCK",
            "message": "Invoice vendor does not match purchase order vendor.",
            "evidence": {
                "invoice_vendor_id": invoice_data["vendor_id"],
                "po_vendor_id": matching_po.get("vendor_id")
            }
        })

    # Check currency.
    if (
        invoice_data.get("currency")
        and invoice_data["currency"] != matching_po.get("currency")
    ):
        findings.append({
            "code": "PO_CURRENCY_MISMATCH",
            "severity": "BLOCK",
            "message": "Invoice currency does not match purchase order currency.",
            "evidence": {
                "invoice_currency": invoice_data["currency"],
                "po_currency": matching_po.get("currency")
            }
        })

    # Check invoice amount against PO amount.
    try:
        invoice_total = Decimal(str(invoice_data["total"]))
        po_total = Decimal(str(matching_po["total_amount"]))

        if invoice_total > po_total:
            findings.append({
                "code": "PO_AMOUNT_EXCEEDED",
                "severity": "BLOCK",
                "message": "Invoice total exceeds purchase order amount.",
                "evidence": {
                    "invoice_total": str(invoice_total),
                    "po_total": str(po_total),
                    "difference": str(invoice_total - po_total)
                }
            })

    except (KeyError, InvalidOperation, TypeError):
        findings.append({
            "code": "PO_AMOUNT_UNVERIFIABLE",
            "severity": "WARNING",
            "message": "Could not verify invoice amount against purchase order.",
            "evidence": {"po_id": po_id}
        })

    return findings