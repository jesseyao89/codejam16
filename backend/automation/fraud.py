from datetime import date


def detect_bank_change_risk(
    invoice_data: dict,
    bank_changes: list
) -> list:
    """
    Flag invoices from vendors with recent,
    unverified banking changes.
    """

    findings = []

    vendor_id = invoice_data.get("vendor_id")
    invoice_date = invoice_data.get("invoice_date")

    if not vendor_id or not invoice_date:
        return findings

    try:
        invoice_day = date.fromisoformat(invoice_date)
    except ValueError:
        return findings

    for change in bank_changes:
        if change.get("vendor_id") != vendor_id:
            continue
        # A rejected change was never applied; it must not keep blocking invoices.
        if change.get("status") == "REJECTED":
            continue

        try:
            change_day = date.fromisoformat(
                change["changed_at"][:10]
            )
        except (ValueError, KeyError):
            continue

        days_since_change = (invoice_day - change_day).days

        if (
            0 <= days_since_change <= 30
            and str(change.get("verified_by_callback", "")).lower() == "no"
        ):
            findings.append({
                "code": "UNVERIFIED_BANK_CHANGE",
                "severity": "BLOCK",
                "message": (
                    "Vendor banking information was recently "
                    "changed without callback verification."
                ),
                "evidence": {
                    "vendor_id": vendor_id,
                    "change_id": change.get("change_id"),
                    "changed_at": change.get("changed_at"),
                    "days_since_change": days_since_change,
                    "request_channel": change.get("request_channel")
                }
            })

    return findings