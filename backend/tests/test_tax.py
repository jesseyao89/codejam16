"""Province-of-delivery tax validation (feature 4)."""

from automation.tax import validate_tax

TAX_CODES = [
    {"code": "GST5", "rate": "0.05"},
    {"code": "HST13", "rate": "0.13"},
    {"code": "PST7_BC", "rate": "0.07"},
    {"code": "QST9975", "rate": "0.09975"},
    {"code": "EXEMPT", "rate": "0"},
    {"code": "FOREIGN", "rate": "0"},
]


def _invoice(**overrides):
    base = {
        "vendor_id": "V015",
        "vendor_country": "CA",
        "vendor_category": "Freight & Carriers",
        "ship_to_province": "ON",
        "subtotal": "1000.00",
        "gst_hst": "130.00",
        "pst_qst": "0.00",
        "total": "1130.00",
        "line_items": [
            {"line_type": "services", "amount": "1000.00"},
        ],
    }
    base.update(overrides)
    return base


def _codes(findings):
    return [finding["code"] for finding in findings]


def _findings(findings, code):
    return [finding for finding in findings if finding["code"] == code]


def test_on_hst_correct():
    assert validate_tax(_invoice(), TAX_CODES) == []


def test_on_hst_wrong_amount_blocks():
    findings = validate_tax(
        _invoice(gst_hst="120.00", total="1120.00"), TAX_CODES
    )
    assert "TAX_RATE_MISMATCH" in _codes(findings)
    mismatch = _findings(findings, "TAX_RATE_MISMATCH")[0]
    assert mismatch["severity"] == "BLOCK"
    assert mismatch["evidence"]["tax_code"] == "HST13"
    assert mismatch["evidence"]["expected_amount"] == "130.00"


def test_on_missing_tax_blocks():
    findings = validate_tax(
        _invoice(gst_hst="0.00", total="1000.00"), TAX_CODES
    )
    assert "TAX_RATE_MISMATCH" in _codes(findings)
    assert _findings(findings, "TAX_RATE_MISMATCH")[0]["severity"] == "BLOCK"


def test_on_pst_is_wrong_province():
    findings = validate_tax(
        _invoice(pst_qst="70.00", total="1200.00"), TAX_CODES
    )
    assert "TAX_PROVINCE_MISMATCH" in _codes(findings)


def test_bc_goods_include_pst():
    invoice = _invoice(
        ship_to_province="BC",
        gst_hst="50.00",
        pst_qst="70.00",
        total="1120.00",
        line_items=[{"line_type": "goods", "amount": "1000.00"}],
    )
    assert validate_tax(invoice, TAX_CODES) == []


def test_bc_services_only_have_no_pst():
    invoice = _invoice(
        ship_to_province="BC",
        gst_hst="50.00",
        pst_qst="0.00",
        total="1050.00",
        line_items=[{"line_type": "services", "amount": "1000.00"}],
    )
    assert validate_tax(invoice, TAX_CODES) == []


def test_bc_mixed_goods_and_services():
    invoice = _invoice(
        ship_to_province="BC",
        gst_hst="50.00",
        pst_qst="35.00",
        total="1085.00",
        line_items=[
            {"line_type": "goods", "amount": "500.00"},
            {"line_type": "services", "amount": "500.00"},
        ],
    )
    assert validate_tax(invoice, TAX_CODES) == []


def test_bc_pst_on_services_blocks():
    invoice = _invoice(
        ship_to_province="BC",
        gst_hst="50.00",
        pst_qst="70.00",
        total="1120.00",
        line_items=[{"line_type": "services", "amount": "1000.00"}],
    )
    findings = validate_tax(invoice, TAX_CODES)
    assert "TAX_RATE_MISMATCH" in _codes(findings)


def test_qc_gst_and_qst():
    invoice = _invoice(
        ship_to_province="QC",
        gst_hst="50.00",
        pst_qst="99.75",
        total="1149.75",
    )
    assert validate_tax(invoice, TAX_CODES) == []


def test_ab_only_gst():
    invoice = _invoice(
        ship_to_province="AB",
        gst_hst="50.00",
        pst_qst="0.00",
        total="1050.00",
    )
    assert validate_tax(invoice, TAX_CODES) == []


def test_ab_pst_blocks():
    invoice = _invoice(
        ship_to_province="AB",
        gst_hst="50.00",
        pst_qst="70.00",
        total="1120.00",
    )
    assert "TAX_PROVINCE_MISMATCH" in _codes(validate_tax(invoice, TAX_CODES))


def test_us_vendor_has_no_canadian_tax():
    invoice = _invoice(
        vendor_country="US",
        ship_to_province="ON",
        gst_hst="0.00",
        pst_qst="0.00",
        total="1000.00",
    )
    assert validate_tax(invoice, TAX_CODES) == []


def test_us_vendor_with_canadian_tax_blocks():
    invoice = _invoice(vendor_country="US")
    findings = validate_tax(invoice, TAX_CODES)
    assert "TAX_RATE_MISMATCH" in _codes(findings)
    assert _findings(findings, "TAX_RATE_MISMATCH")[0]["severity"] == "BLOCK"


def test_insurance_vendor_is_exempt():
    invoice = _invoice(
        vendor_category="Insurance",
        gst_hst="0.00",
        pst_qst="0.00",
        total="1000.00",
    )
    assert validate_tax(invoice, TAX_CODES) == []


def test_missing_province_warns():
    invoice = _invoice(ship_to_province="")
    findings = validate_tax(invoice, TAX_CODES)
    assert _findings(findings, "TAX_PROVINCE_MISMATCH")[0]["severity"] == "WARNING"


def test_tax_code_alias_is_matched():
    invoice = _invoice(
        gst_hst=None,
        pst_qst=None,
        total="1130.00",
        tax_lines=[{"tax_code": "HST", "amount": "130.00"}],
    )
    assert validate_tax(invoice, TAX_CODES) == []


def test_unknown_tax_code_warns():
    invoice = _invoice(
        gst_hst=None,
        pst_qst=None,
        total="1130.00",
        tax_lines=[
            {"tax_code": "HST13", "amount": "130.00"},
            {"tax_code": "MYSTERY", "amount": "1.00"},
        ],
    )
    findings = validate_tax(invoice, TAX_CODES)
    assert any(
        finding["code"] == "TAX_RATE_MISMATCH"
        and finding["severity"] == "WARNING"
        for finding in findings
    )


def test_exempt_tax_code_allows_no_tax():
    invoice = _invoice(
        gst_hst="0.00",
        pst_qst="0.00",
        total="1000.00",
        tax_lines=[{"tax_code": "EXEMPT", "amount": "0.00"}],
    )
    assert validate_tax(invoice, TAX_CODES) == []


def test_missing_tax_code_master_warns():
    invoice = _invoice()
    findings = validate_tax(invoice, [])
    assert _findings(findings, "TAX_RATE_MISMATCH")[0]["severity"] == "WARNING"


def test_credit_note_negative_tax_is_valid():
    invoice = _invoice(
        ship_to_province="BC",
        subtotal="-1000.00",
        gst_hst="-50.00",
        pst_qst="-70.00",
        total="-1120.00",
        line_items=[{"line_type": "goods", "amount": "-1000.00"}],
    )
    assert validate_tax(invoice, TAX_CODES) == []


def test_unknown_province_warns():
    invoice = _invoice(ship_to_province="ZZ")
    findings = validate_tax(invoice, TAX_CODES)
    assert _findings(findings, "TAX_PROVINCE_MISMATCH")[0]["severity"] == "WARNING"
