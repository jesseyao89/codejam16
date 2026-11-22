"""Tax-code helpers: derive the contract's ``tax_lines`` from the two lump sums.

The Invoice model stores two lump amounts (``gst_hst_amount`` / ``pst_qst_amount``)
rather than a per-code list. The contract exposes ``tax_lines`` as
``[{tax_code, rate, amount}]``. We map the lumps onto the canonical codes using
the province of delivery; this is a documented simplification pending richer
extraction (AGENTS.md §8, docs/decisions.md).
"""

from apps.invoices.models import TaxCode


def _rate_str(rate) -> str | None:
    if rate is None:
        return None
    return format(rate.normalize(), "f")


def tax_code_rates() -> dict[str, str | None]:
    return {code.code: _rate_str(code.rate) for code in TaxCode.objects.all()}


def build_tax_lines(gst_hst_amount, pst_qst_amount, province: str | None) -> list:
    """Build the contract ``tax_lines`` array from the two lump amounts."""
    rates = tax_code_rates()
    province = (province or "").strip().upper()
    lines = []

    if gst_hst_amount is not None and gst_hst_amount != 0:
        code = "HST13" if province == "ON" else "GST5"
        lines.append(
            {"tax_code": code, "rate": rates.get(code), "amount": str(gst_hst_amount)}
        )

    if pst_qst_amount is not None and pst_qst_amount != 0:
        code = "QST9975" if province == "QC" else "PST7_BC"
        lines.append(
            {"tax_code": code, "rate": rates.get(code), "amount": str(pst_qst_amount)}
        )

    return lines


def tax_lines_for_invoice(invoice) -> list:
    """Prefer extraction tax lines; fall back to the lump-sum mapping."""
    raw = invoice.raw_extraction if isinstance(invoice.raw_extraction, dict) else {}
    extracted = raw.get("tax_lines")
    if isinstance(extracted, list):
        rates = tax_code_rates()
        lines = []
        for line in extracted:
            if not isinstance(line, dict):
                continue
            code = line.get("tax_code")
            amount = line.get("amount")
            if not code or amount in (None, ""):
                continue
            code = str(code)
            lines.append(
                {
                    "tax_code": code,
                    "rate": line.get("rate") or rates.get(code),
                    "amount": str(amount),
                }
            )
        if lines:
            return lines
    return build_tax_lines(
        invoice.gst_hst_amount,
        invoice.pst_qst_amount,
        invoice.ship_to_province,
    )
