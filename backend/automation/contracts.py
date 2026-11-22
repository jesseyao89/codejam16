from datetime import date
from decimal import Decimal, InvalidOperation


def _decimal(value):
    if value is None or value == "":
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return parsed if parsed.is_finite() else None


def _finding(code, severity, message, evidence):
    return {
        "code": code,
        "severity": severity,
        "message": message,
        "evidence": evidence,
    }


def _prior_month_spend(invoice_data, contract_id, historical_invoices):
    month = (invoice_data.get("invoice_date") or "")[:7]
    if not month:
        return None
    prior = Decimal("0")
    invoice_id = invoice_data.get("invoice_id")
    for row in historical_invoices or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("contract_id") or "") != contract_id:
            continue
        if invoice_id and row.get("invoice_id") == invoice_id:
            continue
        if str(row.get("invoice_date") or "")[:7] != month:
            continue
        amount = _decimal(row.get("subtotal"))
        if amount is not None and amount > 0:
            prior += amount
    return prior


def _check_rate_cap(invoice_data, contract) -> list:
    if contract.get("billing_type") != "rate_card":
        return []
    cap = _decimal(contract.get("hourly_rate_cap"))
    if cap is None:
        return []
    findings = []
    for line in invoice_data.get("line_items") or []:
        if not isinstance(line, dict):
            continue
        unit_price = _decimal(line.get("unit_price"))
        if unit_price is None or unit_price <= cap:
            continue
        findings.append(
            _finding(
                "CONTRACT_RATE_EXCEEDED",
                "WARNING",
                "Invoice line unit price exceeds the contract's hourly rate cap.",
                {
                    "contract_id": contract.get("contract_id"),
                    "line_no": line.get("line_no"),
                    "description": line.get("description"),
                    "unit_price": str(unit_price),
                    "hourly_rate_cap": str(cap),
                    "difference": str(unit_price - cap),
                },
            )
        )
    return findings


def _check_monthly_cap(invoice_data, contract, historical_invoices) -> list:
    cap = _decimal(contract.get("not_to_exceed_monthly"))
    if cap is None:
        return []
    subtotal = _decimal(invoice_data.get("subtotal"))
    if subtotal is None:
        return [
            _finding(
                "CONTRACT_MONTHLY_CAP_EXCEEDED",
                "WARNING",
                "Invoice subtotal is missing; the contract monthly cap could not be checked.",
                {"contract_id": contract.get("contract_id")},
            )
        ]
    prior = _prior_month_spend(
        invoice_data, str(contract.get("contract_id") or ""), historical_invoices
    )
    if prior is None:
        return []
    cumulative = prior + subtotal
    if cumulative <= cap:
        return []
    return [
        _finding(
            "CONTRACT_MONTHLY_CAP_EXCEEDED",
            "BLOCK",
            "Invoices linked to this contract exceed its monthly cap.",
            {
                "contract_id": contract.get("contract_id"),
                "month": (invoice_data.get("invoice_date") or "")[:7],
                "monthly_cap": str(cap),
                "prior_invoiced": str(prior),
                "current_invoice": str(subtotal),
                "cumulative": str(cumulative),
                "difference": str(cumulative - cap),
            },
        )
    ]


def match_contract(
    invoice_data: dict,
    contracts: list,
    historical_invoices: list | None = None,
) -> list:
    """Compare an invoice with its referenced contract and spending caps."""
    findings = []

    contract_id = invoice_data.get("contract_id")
    contract_reference = invoice_data.get("contract_reference")

    if not contract_id:
        if contract_reference:
            return [
                _finding(
                    "CONTRACT_NOT_FOUND",
                    "BLOCK",
                    "Referenced contract was not found.",
                    {"contract_reference": contract_reference},
                )
            ]
        return findings

    contract = next(
        (c for c in contracts if c.get("contract_id") == contract_id), None
    )

    if contract is None:
        return [
            _finding(
                "CONTRACT_NOT_FOUND",
                "BLOCK",
                "Referenced contract was not found.",
                {"contract_id": contract_id},
            )
        ]

    if (
        invoice_data.get("vendor_id")
        and invoice_data["vendor_id"] != contract.get("vendor_id")
    ):
        findings.append(
            _finding(
                "CONTRACT_VENDOR_MISMATCH",
                "BLOCK",
                "Invoice vendor does not match contract vendor.",
                {
                    "invoice_vendor_id": invoice_data["vendor_id"],
                    "contract_vendor_id": contract.get("vendor_id"),
                },
            )
        )

    if (
        invoice_data.get("currency")
        and invoice_data["currency"] != contract.get("currency")
    ):
        findings.append(
            _finding(
                "CONTRACT_CURRENCY_MISMATCH",
                "BLOCK",
                "Invoice currency does not match contract currency.",
                {
                    "invoice_currency": invoice_data["currency"],
                    "contract_currency": contract.get("currency"),
                },
            )
        )

    if str(contract.get("status") or "").lower() != "active":
        findings.append(
            _finding(
                "CONTRACT_INACTIVE",
                "BLOCK",
                "Contract is not active.",
                {
                    "contract_id": contract_id,
                    "status": contract.get("status"),
                },
            )
        )

    try:
        invoice_date = date.fromisoformat(invoice_data["invoice_date"])
        start_date = date.fromisoformat(contract["start_date"])
        end_date = date.fromisoformat(contract["end_date"])
        if not (start_date <= invoice_date <= end_date):
            findings.append(
                _finding(
                    "CONTRACT_DATE_OUTSIDE_TERM",
                    "BLOCK",
                    "Invoice date is outside the contract term.",
                    {
                        "invoice_date": str(invoice_date),
                        "start_date": str(start_date),
                        "end_date": str(end_date),
                    },
                )
            )
    except (KeyError, ValueError, TypeError):
        findings.append(
            _finding(
                "CONTRACT_DATE_UNVERIFIABLE",
                "WARNING",
                "Could not verify invoice date against contract term.",
                {"contract_id": contract_id},
            )
        )

    if contract.get("billing_type") == "fixed_monthly":
        invoice_subtotal = _decimal(invoice_data.get("subtotal"))
        monthly_fee = _decimal(contract.get("monthly_fee"))
        if invoice_subtotal is None or monthly_fee is None:
            findings.append(
                _finding(
                    "CONTRACT_FEE_UNVERIFIABLE",
                    "WARNING",
                    "Could not verify invoice against monthly fee.",
                    {"contract_id": contract_id},
                )
            )
        elif invoice_subtotal > monthly_fee:
            findings.append(
                _finding(
                    "CONTRACT_FEE_EXCEEDED",
                    "BLOCK",
                    "Invoice subtotal exceeds contracted monthly fee.",
                    {
                        "invoice_subtotal": str(invoice_subtotal),
                        "monthly_fee": str(monthly_fee),
                        "difference": str(invoice_subtotal - monthly_fee),
                    },
                )
            )

    findings.extend(_check_rate_cap(invoice_data, contract))
    findings.extend(_check_monthly_cap(invoice_data, contract, historical_invoices))
    return findings
