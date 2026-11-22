"""Combine invoice checks into one review result."""

from .validation import validate_invoice
from .duplicates import detect_duplicates
from .fraud import detect_bank_change_risk
from .matching import match_purchase_order
from .contracts import match_contract
from .coding import suggest_coding


def analyze_invoice(invoice_data: dict, reference_data: dict) -> dict:
    findings = []

    # 1. Validate invoice information
    findings.extend(validate_invoice(invoice_data))

    # 2. Detect duplicate invoices
    findings.extend(detect_duplicates(
        invoice_data,
        reference_data.get("historical_invoices", [])
    ))

    # 3. Detect suspicious bank account changes
    findings.extend(detect_bank_change_risk(
        invoice_data,
        reference_data.get("bank_changes", [])
    ))

    # 4. Match purchase orders
    if invoice_data.get("po_id"):
        findings.extend(match_purchase_order(
            invoice_data,
            reference_data.get("purchase_orders", [])
        ))

    # 5. Match contracts
    if invoice_data.get("contract_id"):
        findings.extend(match_contract(
            invoice_data,
            reference_data.get("contracts", [])
        ))

    # 6. Suggest per-line GL/department coding (best-effort; degrades to
    # explicit null suggestions that require manual review).
    coding_suggestions = []

    if invoice_data.get("line_items"):
        try:
            coding_suggestions = suggest_coding(invoice_data, reference_data)
        except Exception:  # noqa: BLE001 - provider errors degrade gracefully
            coding_suggestions = []

    # 7. Determine final status
    if any(f.get("severity") == "BLOCK" for f in findings):
        status = "BLOCKED"
    elif any(f.get("severity") == "WARNING" for f in findings):
        status = "WARNING"
    else:
        status = "PASSED"

    return {
        "validation_status": status,
        "findings": findings,
        "coding_suggestions": coding_suggestions,
        "extraction": invoice_data,
    }