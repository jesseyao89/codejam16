from datetime import date
from decimal import Decimal, InvalidOperation


def match_contract(invoice_data: dict, contracts: list) -> list:
    """
    Compare an invoice with its referenced contract.
    Returns a list of findings.
    """

    findings = []
    contract_id = invoice_data.get("contract_id")

    if not contract_id:
        return findings

    contract = next(
        (c for c in contracts if c.get("contract_id") == contract_id),
        None
    )

    if contract is None:
        return [{
            "code": "CONTRACT_NOT_FOUND",
            "severity": "BLOCK",
            "message": "Referenced contract was not found.",
            "evidence": {"contract_id": contract_id}
        }]

    # Check vendor identity.
    if (
        invoice_data.get("vendor_id")
        and invoice_data["vendor_id"] != contract.get("vendor_id")
    ):
        findings.append({
            "code": "CONTRACT_VENDOR_MISMATCH",
            "severity": "BLOCK",
            "message": "Invoice vendor does not match contract vendor.",
            "evidence": {
                "invoice_vendor_id": invoice_data["vendor_id"],
                "contract_vendor_id": contract.get("vendor_id")
            }
        })

    # Check currency.
    if (
        invoice_data.get("currency")
        and invoice_data["currency"] != contract.get("currency")
    ):
        findings.append({
            "code": "CONTRACT_CURRENCY_MISMATCH",
            "severity": "BLOCK",
            "message": "Invoice currency does not match contract currency.",
            "evidence": {
                "invoice_currency": invoice_data["currency"],
                "contract_currency": contract.get("currency")
            }
        })

    # Check contract status.
    if contract.get("status", "").lower() != "active":
        findings.append({
            "code": "CONTRACT_INACTIVE",
            "severity": "BLOCK",
            "message": "Contract is not active.",
            "evidence": {
                "contract_id": contract_id,
                "status": contract.get("status")
            }
        })

    # Check contract dates.
    try:
        invoice_date = date.fromisoformat(invoice_data["invoice_date"])
        start_date = date.fromisoformat(contract["start_date"])
        end_date = date.fromisoformat(contract["end_date"])

        if not (start_date <= invoice_date <= end_date):
            findings.append({
                "code": "CONTRACT_DATE_OUTSIDE_TERM",
                "severity": "BLOCK",
                "message": "Invoice date is outside the contract term.",
                "evidence": {
                    "invoice_date": str(invoice_date),
                    "start_date": str(start_date),
                    "end_date": str(end_date)
                }
            })

    except (KeyError, ValueError, TypeError):
        findings.append({
            "code": "CONTRACT_DATE_UNVERIFIABLE",
            "severity": "WARNING",
            "message": "Could not verify invoice date against contract term.",
            "evidence": {"contract_id": contract_id}
        })

       # Check fixed monthly fee.
    if contract.get("billing_type") == "fixed_monthly":
        try:
            invoice_subtotal = Decimal(str(invoice_data["subtotal"]))
            monthly_fee = Decimal(str(contract["monthly_fee"]))

            if invoice_subtotal > monthly_fee:
                findings.append({
                    "code": "CONTRACT_FEE_EXCEEDED",
                    "severity": "BLOCK",
                    "message": "Invoice subtotal exceeds contracted monthly fee.",
                    "evidence": {
                        "invoice_subtotal": str(invoice_subtotal),
                        "monthly_fee": str(monthly_fee),
                        "difference": str(invoice_subtotal - monthly_fee)
                    }
                })

        except (KeyError, InvalidOperation, TypeError):
            findings.append({
                "code": "CONTRACT_FEE_UNVERIFIABLE",
                "severity": "WARNING",
                "message": "Could not verify invoice against monthly fee.",
                "evidence": {"contract_id": contract_id}
            })

    return findings