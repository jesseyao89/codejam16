from unittest import mock

from automation.contracts import match_contract
from automation.duplicates import detect_duplicates
from automation.fraud import detect_bank_change_risk
from automation.matching import match_purchase_order
from automation.pipeline import analyze_invoice
from automation.validation import validate_invoice


def _invoice(**overrides):
    base = {
        "vendor_id": "V015",
        "vendor_name": "Polar Freight Lines Ltd.",
        "invoice_number": "INV-100",
        "invoice_date": "2026-10-01",
        "currency": "CAD",
        "subtotal": "100.00",
        "gst_hst": "5.00",
        "pst_qst": "0.00",
        "total": "105.00",
    }
    base.update(overrides)
    return base


def test_envelope_uses_validation_status():
    result = analyze_invoice(_invoice(), {})
    assert set(result) == {
        "validation_status",
        "findings",
        "coding_suggestions",
        "extraction",
    }
    assert result["validation_status"] == "PASSED"
    assert result["findings"] == []


def test_envelope_status_is_blocked_when_finding_blocks():
    result = analyze_invoice(_invoice(total="999.00"), {})
    assert result["validation_status"] == "BLOCKED"


def test_validation_passes_clean_invoice():
    assert validate_invoice(_invoice()) == []


def test_validation_flags_total_mismatch():
    findings = validate_invoice(_invoice(total="200.00"))
    assert any(f["code"] == "TOTAL_MISMATCH" and f["severity"] == "BLOCK" for f in findings)


def test_validation_flags_missing_field():
    findings = validate_invoice({"invoice_number": "X", "invoice_date": "2026-01-01"})
    assert any(f["code"] == "MISSING_FIELD" for f in findings)


def test_duplicate_exact_match_blocks():
    history = [{"invoice_id": "AP-00001", "vendor_id": "V015", "invoice_number": "INV-100"}]
    findings = detect_duplicates(_invoice(), history)
    assert any(
        f["code"] == "EXACT_DUPLICATE"
        and f["severity"] == "BLOCK"
        and f["evidence"]["match_type"] == "EXACT"
        for f in findings
    )


def test_duplicate_reformatted_number_blocks():
    history = [{"invoice_id": "AP-00001", "vendor_id": "V015", "invoice_number": "inv 100"}]
    findings = detect_duplicates(_invoice(), history)
    assert any(
        f["code"] == "EXACT_DUPLICATE"
        and f["evidence"]["match_type"] == "REFORMATTED"
        for f in findings
    )


def test_duplicate_near_amount_and_date_warns():
    history = [
        {
            "invoice_id": "AP-00002",
            "vendor_id": "V015",
            "invoice_number": "INV-200",
            "invoice_date": "2026-09-29",
            "currency": "CAD",
            "total": "105.00",
        }
    ]
    findings = detect_duplicates(_invoice(), history)
    assert any(
        f["code"] == "POSSIBLE_DUPLICATE"
        and f["severity"] == "WARNING"
        and f["evidence"]["match_type"] == "NEAR"
        for f in findings
    )


def test_duplicate_near_outside_window_ignored():
    history = [
        {
            "invoice_id": "AP-00003",
            "vendor_id": "V015",
            "invoice_number": "INV-300",
            "invoice_date": "2026-08-01",
            "currency": "CAD",
            "total": "105.00",
        }
    ]
    assert detect_duplicates(_invoice(), history) == []


def test_duplicate_no_match():
    history = [{"invoice_id": "AP-00001", "vendor_id": "V015", "invoice_number": "INV-999"}]
    assert detect_duplicates(_invoice(), history) == []


def test_po_amount_exceeded():
    invoice = _invoice(po_id="PO-2026-0001", total="150.00")
    pos = [{"po_id": "PO-2026-0001", "vendor_id": "V015", "currency": "CAD", "total_amount": "100.00"}]
    findings = match_purchase_order(invoice, pos)
    assert any(f["code"] == "PO_AMOUNT_EXCEEDED" for f in findings)


def test_po_matches_clean():
    invoice = _invoice(po_id="PO-2026-0001", total="100.00")
    pos = [{"po_id": "PO-2026-0001", "vendor_id": "V015", "currency": "CAD", "total_amount": "100.00"}]
    assert match_purchase_order(invoice, pos) == []


def test_contract_fee_exceeded():
    invoice = _invoice(contract_id="C001", subtotal="3000.00", invoice_date="2026-06-15")
    contracts = [
        {
            "contract_id": "C001",
            "vendor_id": "V015",
            "currency": "CAD",
            "status": "active",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "billing_type": "fixed_monthly",
            "monthly_fee": "2400.00",
        }
    ]
    findings = match_contract(invoice, contracts)
    assert any(f["code"] == "CONTRACT_FEE_EXCEEDED" for f in findings)


def test_analysis_degrades_when_coding_fails():
    # A provider error (e.g. missing API key) must not crash analysis; the
    # deterministic validation findings are still returned (AGENTS.md §9).
    ref = {"gl_accounts": [{"account_number": "5010", "name": "Freight", "account_type": "expense"}]}
    with mock.patch("automation.pipeline.suggest_gl_account", side_effect=RuntimeError("no key")):
        result = analyze_invoice(_invoice(), ref)
    assert result["coding_suggestions"] == []
    assert result["validation_status"] == "PASSED"


def test_fraud_flags_recent_unverified_bank_change():
    invoice = _invoice(vendor_id="V043", invoice_date="2026-01-20")
    changes = [
        {
            "change_id": "BC-001",
            "vendor_id": "V043",
            "changed_at": "2026-01-14",
            "request_channel": "email_request",
            "verified_by_callback": "no",
        }
    ]
    findings = detect_bank_change_risk(invoice, changes)
    assert any(f["code"] == "UNVERIFIED_BANK_CHANGE" for f in findings)
