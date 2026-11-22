"""Deterministic tax validation by place of supply (feature 4).

Expected tax codes and rates come from the supplied tax-code master. The
province of delivery decides which codes apply; vendor country/category decides
whether Canadian tax applies at all. Findings are stable codes with evidence.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

CA_PROVINCES = {
    "AB",
    "BC",
    "MB",
    "NB",
    "NL",
    "NS",
    "NT",
    "NU",
    "ON",
    "PE",
    "QC",
    "SK",
    "YT",
}

HST_PROVINCES = {"ON"}
PST_PROVINCES = {"BC"}
QST_PROVINCES = {"QC"}


def _decimal(value) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return parsed if parsed.is_finite() else None


def _truthy(value) -> bool:
    return str(value or "").strip().lower() in ("yes", "true", "1", "y")


def _rates(tax_codes) -> dict[str, Decimal]:
    rates = {}
    for item in tax_codes or []:
        if not isinstance(item, dict) or not item.get("code"):
            continue
        rate = _decimal(item.get("rate"))
        if rate is not None:
            rates[str(item["code"]).upper()] = rate
    return rates


def _expected_codes(
    province: str,
    country: str,
    category: str,
    subtotal: Decimal | None,
    goods_base: Decimal | None,
) -> list[tuple[str, Decimal]]:
    if category.strip().casefold() == "insurance":
        return []
    if country and country.upper() != "CA":
        return []
    if province in HST_PROVINCES:
        return [("HST13", subtotal)]
    if province in PST_PROVINCES:
        return [
            ("GST5", subtotal),
            ("PST7_BC", goods_base if goods_base is not None else subtotal),
        ]
    if province in QST_PROVINCES:
        return [("GST5", subtotal), ("QST9975", subtotal)]
    if province in CA_PROVINCES:
        return [("GST5", subtotal)]
    return []


def _goods_base(invoice_data: dict, subtotal: Decimal | None) -> Decimal | None:
    lines = invoice_data.get("line_items")
    if not isinstance(lines, list) or not lines:
        return subtotal
    total = Decimal("0")
    found_goods = False
    for line in lines:
        if not isinstance(line, dict):
            continue
        if str(line.get("line_type") or "").casefold() != "goods":
            continue
        amount = _decimal(line.get("amount"))
        if amount is None:
            continue
        found_goods = True
        total += amount
    return total if found_goods else Decimal("0")


def _actual_by_code(invoice_data: dict, province: str) -> tuple[dict[str, Decimal], bool]:
    tax_lines = invoice_data.get("tax_lines")
    if isinstance(tax_lines, list) and tax_lines:
        actual: dict[str, Decimal] = {}
        for line in tax_lines:
            if not isinstance(line, dict):
                continue
            code = str(line.get("tax_code") or "").strip().upper()
            amount = _decimal(line.get("amount"))
            if not code or amount is None:
                continue
            actual[code] = actual.get(code, Decimal("0")) + amount
        return actual, True

    gst = _decimal(invoice_data.get("gst_hst")) or Decimal("0")
    pst = _decimal(invoice_data.get("pst_qst")) or Decimal("0")
    actual = {}
    if province in HST_PROVINCES:
        if gst:
            actual["HST13"] = gst
        if pst:
            actual["PST7_BC"] = pst
    elif province in PST_PROVINCES:
        if gst:
            actual["GST5"] = gst
        if pst:
            actual["PST7_BC"] = pst
    elif province in QST_PROVINCES:
        if gst:
            actual["GST5"] = gst
        if pst:
            actual["QST9975"] = pst
    else:
        if gst:
            actual["GST5"] = gst
        if pst:
            actual["PST7_BC"] = pst
    return actual, False


def _canonical_actual_code(
    code: str, expected_codes: list[str]
) -> str:
    if code in expected_codes:
        return code
    for expected in expected_codes:
        if code.startswith(expected[:3]) or expected.startswith(code[:3]):
            return expected
    return code


def _finding(code: str, severity: str, message: str, evidence: dict) -> dict:
    return {
        "code": code,
        "severity": severity,
        "message": message,
        "evidence": evidence,
    }


def validate_tax(invoice_data: dict, tax_codes) -> list:
    """Compare extracted tax with the tax expected for the place of supply."""
    findings = []

    province = str(invoice_data.get("ship_to_province") or "").strip().upper()
    country = str(invoice_data.get("vendor_country") or "").strip().upper()
    category = str(invoice_data.get("vendor_category") or "").strip()
    subtotal = _decimal(invoice_data.get("subtotal"))
    tax_codes = tax_codes or []

    declared_exempt = any(
        isinstance(line, dict)
        and str(line.get("tax_code") or "").strip().upper()
        in ("EXEMPT", "FOREIGN")
        for line in invoice_data.get("tax_lines") or []
    )

    if not tax_codes:
        if (
            province in CA_PROVINCES
            and country in ("", "CA")
            and category.casefold() != "insurance"
            and not declared_exempt
            and subtotal is not None
        ):
            return [
                _finding(
                    "TAX_RATE_MISMATCH",
                    "WARNING",
                    "Tax-code master is missing; tax could not be verified.",
                    {"province": province},
                )
            ]
        return findings

    if declared_exempt:
        expected = []
        expected_reason = "exempt"
    elif country and country != "CA":
        expected = []
        expected_reason = "foreign"
    elif category.casefold() == "insurance":
        expected = []
        expected_reason = "insurance"
    elif not province:
        findings.append(
            _finding(
                "TAX_PROVINCE_MISMATCH",
                "WARNING",
                "Place of supply is missing; tax cannot be verified.",
                {"ship_to_province": None},
            )
        )
        return findings
    elif province not in CA_PROVINCES:
        if country == "CA":
            findings.append(
                _finding(
                    "TAX_PROVINCE_MISMATCH",
                    "WARNING",
                    f"Unknown place of supply {province!r}; tax cannot be verified.",
                    {"ship_to_province": province},
                )
            )
            return findings
        # No Canadian country given and a non-Canadian province/state: treat as
        # a foreign/zero-tax invoice rather than guessing Canadian tax.
        expected = []
        expected_reason = "foreign"
    else:
        expected_reason = "canadian"
        expected = _expected_codes(
            province,
            country,
            category,
            subtotal,
            _goods_base(invoice_data, subtotal),
        )

    actual, from_tax_lines = _actual_by_code(invoice_data, province)
    actual_total = sum(actual.values(), Decimal("0"))

    if expected_reason in ("foreign", "insurance", "exempt"):
        if abs(actual_total) > Decimal("0.02"):
            findings.append(
                _finding(
                    "TAX_RATE_MISMATCH",
                    "BLOCK",
                    (
                        "Canadian tax was charged but the vendor/category is "
                        f"{expected_reason}; expected no Canadian tax."
                    ),
                    {
                        "province": province or None,
                        "vendor_country": country or None,
                        "vendor_category": category or None,
                        "actual_tax": str(actual_total),
                    },
                )
            )
        return findings

    if subtotal is None:
        findings.append(
            _finding(
                "TAX_RATE_MISMATCH",
                "WARNING",
                "Invoice subtotal is missing; tax could not be verified.",
                {"province": province, "ship_to_province": province},
            )
        )
        return findings

    rates = _rates(tax_codes)
    expected_codes = [code for code, _base in expected]
    seen_actual_codes = set()

    for code, base in expected:
        if base is None:
            continue
        rate = rates.get(code)
        if rate is None:
            findings.append(
                _finding(
                    "TAX_RATE_MISMATCH",
                    "WARNING",
                    f"Tax code {code} is missing a rate in the tax-code master.",
                    {"tax_code": code, "province": province},
                )
            )
            continue
        expected_amount = (base * rate).quantize(Decimal("0.01"))
        actual_amount = Decimal("0")
        for actual_code, amount in actual.items():
            canonical = _canonical_actual_code(actual_code, expected_codes)
            if canonical == code:
                actual_amount += amount
                seen_actual_codes.add(actual_code)
        difference = actual_amount - expected_amount
        if abs(difference) > Decimal("0.02"):
            findings.append(
                _finding(
                    "TAX_RATE_MISMATCH",
                    "BLOCK",
                    (
                        f"{code} should be {expected_amount} on "
                        f"{base} at {rate}; invoice shows {actual_amount}."
                    ),
                    {
                        "tax_code": code,
                        "province": province,
                        "rate": str(rate),
                        "taxable_amount": str(base),
                        "expected_amount": str(expected_amount),
                        "actual_amount": str(actual_amount),
                        "difference": str(difference),
                        "source": "tax_lines" if from_tax_lines else "lumps",
                    },
                )
            )

    for actual_code, amount in actual.items():
        canonical = _canonical_actual_code(actual_code, expected_codes)
        if canonical in expected_codes or actual_code in seen_actual_codes:
            continue
        if abs(amount) <= Decimal("0.02"):
            continue
        if actual_code not in rates:
            findings.append(
                _finding(
                    "TAX_RATE_MISMATCH",
                    "WARNING",
                    f"Tax code {actual_code} is not in the tax-code master.",
                    {
                        "tax_code": actual_code,
                        "province": province,
                        "actual_amount": str(amount),
                    },
                )
            )
        else:
            findings.append(
                _finding(
                    "TAX_PROVINCE_MISMATCH",
                    "BLOCK",
                    (
                        f"Tax code {actual_code} is not applicable to "
                        f"place of supply {province}."
                    ),
                    {
                        "tax_code": actual_code,
                        "province": province,
                        "actual_amount": str(amount),
                    },
                )
            )

    # If the invoice has no tax at all where tax is expected, the per-code
    # comparison above already emits a mismatch for a non-zero expected amount.
    # Keep a single clear finding when the whole tax amount is zero.
    if from_tax_lines:
        tax_total = sum(
            (
                _decimal(line.get("amount")) or Decimal("0")
                for line in invoice_data.get("tax_lines") or []
                if isinstance(line, dict)
            ),
            Decimal("0"),
        )
    else:
        tax_total = (_decimal(invoice_data.get("gst_hst")) or Decimal("0")) + (
            _decimal(invoice_data.get("pst_qst")) or Decimal("0")
        )
    expected_total = sum(
        ((base or Decimal("0")) * rates.get(code, Decimal("0"))).quantize(Decimal("0.01"))
        for code, base in expected
        if code in rates
    )
    if (
        abs(expected_total) > Decimal("0.02")
        and abs(tax_total) <= Decimal("0.02")
        and not any(
            finding["code"] == "TAX_RATE_MISMATCH"
            and finding.get("evidence", {}).get("tax_code")
            for finding in findings
        )
    ):
        findings.append(
            _finding(
                "TAX_RATE_MISMATCH",
                "BLOCK",
                f"Tax is missing; {province} requires tax on this invoice.",
                {
                    "province": province,
                    "expected_total": str(expected_total),
                    "actual_total": str(tax_total),
                },
            )
        )

    return findings
