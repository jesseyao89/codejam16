import json
from types import SimpleNamespace
from unittest import mock

from automation.coding import suggest_coding
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
    invoice = _invoice(
        line_items=[{"line_no": 1, "description": "Freight services"}]
    )
    with mock.patch(
        "automation.pipeline.suggest_coding", side_effect=RuntimeError("no key")
    ) as coding:
        result = analyze_invoice(invoice, ref)
    assert coding.called
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


# --- PO / contract matching -------------------------------------------------


def test_po_required_but_missing_warns():
    invoice = _invoice(vendor_requires_po="yes")
    findings = match_purchase_order(invoice, [])
    assert any(
        finding["code"] == "PO_REQUIRED_MISSING"
        and finding["severity"] == "WARNING"
        for finding in findings
    )


def test_po_reference_not_found_blocks():
    invoice = _invoice(po_reference="PO-DOES-NOT-EXIST")
    findings = match_purchase_order(invoice, [])
    assert any(
        finding["code"] == "PO_NOT_FOUND"
        and finding["severity"] == "BLOCK"
        for finding in findings
    )


def test_po_cumulative_exceeded_blocks():
    invoice = _invoice(
        invoice_id="AP-2",
        po_id="PO-1",
        total="60.00",
        currency="CAD",
    )
    purchase_orders = [
        {
            "po_id": "PO-1",
            "vendor_id": "V015",
            "currency": "CAD",
            "total_amount": "100.00",
        }
    ]
    historical = [
        {
            "invoice_id": "AP-1",
            "po_id": "PO-1",
            "currency": "CAD",
            "total": "50.00",
        }
    ]
    findings = match_purchase_order(invoice, purchase_orders, historical)
    assert any(
        finding["code"] == "PO_CUMULATIVE_EXCEEDED"
        and finding["severity"] == "BLOCK"
        for finding in findings
    )


def test_po_cumulative_excludes_the_current_invoice():
    invoice = _invoice(
        invoice_id="AP-2",
        po_id="PO-1",
        total="60.00",
        currency="CAD",
    )
    purchase_orders = [
        {
            "po_id": "PO-1",
            "vendor_id": "V015",
            "currency": "CAD",
            "total_amount": "110.00",
        }
    ]
    historical = [
        {
            "invoice_id": "AP-1",
            "po_id": "PO-1",
            "currency": "CAD",
            "total": "50.00",
        },
        {
            "invoice_id": "AP-2",
            "po_id": "PO-1",
            "currency": "CAD",
            "total": "60.00",
        },
    ]
    findings = match_purchase_order(invoice, purchase_orders, historical)
    assert not any(
        finding["code"] == "PO_CUMULATIVE_EXCEEDED"
        for finding in findings
    )


def _contract(**overrides):
    contract = {
        "contract_id": "C001",
        "vendor_id": "V015",
        "currency": "CAD",
        "status": "active",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "billing_type": "rate_card",
        "monthly_fee": None,
        "hourly_rate_cap": "100.00",
        "not_to_exceed_monthly": "1000.00",
    }
    contract.update(overrides)
    return contract


def test_contract_reference_not_found_blocks():
    invoice = _invoice(contract_reference="C-DOES-NOT-EXIST")
    findings = match_contract(invoice, [])
    assert any(
        finding["code"] == "CONTRACT_NOT_FOUND"
        and finding["severity"] == "BLOCK"
        for finding in findings
    )


def test_contract_rate_cap_exceeded_warns():
    invoice = _invoice(
        contract_id="C001",
        line_items=[
            {"line_no": 1, "description": "Consulting", "unit_price": "150.00", "amount": "150.00"}
        ],
    )
    findings = match_contract(invoice, [_contract()])
    assert any(
        finding["code"] == "CONTRACT_RATE_EXCEEDED"
        and finding["severity"] == "WARNING"
        for finding in findings
    )


def test_contract_monthly_cap_exceeded_blocks():
    invoice = _invoice(
        invoice_id="AP-2",
        contract_id="C001",
        invoice_date="2026-06-15",
        subtotal="300.00",
        total="315.00",
    )
    historical = [
        {
            "invoice_id": "AP-1",
            "contract_id": "C001",
            "invoice_date": "2026-06-01",
            "subtotal": "800.00",
        }
    ]
    findings = match_contract(invoice, [_contract()], historical)
    assert any(
        finding["code"] == "CONTRACT_MONTHLY_CAP_EXCEEDED"
        and finding["severity"] == "BLOCK"
        for finding in findings
    )


def test_contract_monthly_cap_excludes_current_invoice():
    invoice = _invoice(
        invoice_id="AP-2",
        contract_id="C001",
        invoice_date="2026-06-15",
        subtotal="300.00",
        total="315.00",
    )
    historical = [
        {
            "invoice_id": "AP-1",
            "contract_id": "C001",
            "invoice_date": "2026-06-01",
            "subtotal": "700.00",
        },
        {
            "invoice_id": "AP-2",
            "contract_id": "C001",
            "invoice_date": "2026-06-15",
            "subtotal": "300.00",
        },
    ]
    findings = match_contract(invoice, [_contract()], historical)
    assert not any(
        finding["code"] == "CONTRACT_MONTHLY_CAP_EXCEEDED"
        for finding in findings
    )


def test_card_invoice_with_different_number_warns():
    invoice = _invoice(invoice_number="INV-NEW")
    historical = [
        {
            "invoice_id": "AP-1",
            "vendor_id": "V015",
            "invoice_number": "INV-OLD",
            "invoice_date": "2026-09-20",
            "currency": "CAD",
            "total": "105.00",
            "payment_method": "CARD",
        }
    ]
    findings = detect_duplicates(invoice, historical)
    assert any(
        finding["code"] == "CARD_INVOICE"
        and finding["severity"] == "WARNING"
        for finding in findings
    )


def test_card_invoice_outside_window_ignored():
    invoice = _invoice(invoice_number="INV-NEW")
    historical = [
        {
            "invoice_id": "AP-1",
            "vendor_id": "V015",
            "invoice_number": "INV-OLD",
            "invoice_date": "2026-01-01",
            "currency": "CAD",
            "total": "105.00",
            "payment_method": "CARD",
        }
    ]
    assert detect_duplicates(invoice, historical) == []


# --- Per-line coding --------------------------------------------------------


def _coding_reference(**overrides):
    reference = {
        "gl_accounts": [
            {"account_number": "5010", "name": "Freight", "account_type": "expense"},
            {"account_number": "6110", "name": "Software", "account_type": "expense"},
        ],
        "departments": [
            {"department_id": "D01", "name": "Operations"},
            {"department_id": "D05", "name": "IT"},
        ],
        "historical_lines": [
            {
                "invoice_id": "AP-00001",
                "vendor_id": "V015",
                "description": "Freight services Toronto to Montreal",
                "gl_account": "5010",
                "department_id": "D01",
            },
            {
                "invoice_id": "AP-00002",
                "vendor_id": "V015",
                "description": "Freight services Toronto",
                "gl_account": "5010",
                "department_id": "D01",
            },
            {
                "invoice_id": "AP-00003",
                "vendor_id": "V015",
                "description": "Cloudbarn Workspace subscription (24 seats)",
                "gl_account": "6110",
                "department_id": "D05",
            },
        ],
    }
    reference.update(overrides)
    return reference


def _fake_ai(payload):
    class FakeResponses:
        def create(self, **kwargs):
            return SimpleNamespace(output_text=json.dumps(payload))

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.responses = FakeResponses()

    return FakeClient


def test_coding_suggests_each_line_from_history():
    invoice = _invoice(
        line_items=[
            {"line_no": 1, "description": "Freight services Toronto"},
            {
                "line_no": 2,
                "description": "Cloudbarn Workspace subscription (24 seats)",
            },
        ]
    )

    suggestions = suggest_coding(invoice, _coding_reference())

    assert [row["line_no"] for row in suggestions] == [1, 2]
    freight, software = suggestions
    assert freight["suggested_gl_account"] == "5010"
    assert freight["suggested_department_id"] == "D01"
    assert freight["confidence"] is not None
    assert "historical" in freight["reason"].lower()
    assert software["suggested_gl_account"] == "6110"
    assert software["suggested_department_id"] == "D05"
    assert "Cloudbarn" in software["reason"]


def test_coding_ignores_history_from_another_vendor():
    reference = _coding_reference(
        historical_lines=[
            {
                "invoice_id": "AP-00001",
                "vendor_id": "V999",
                "description": "Freight services Toronto",
                "gl_account": "5010",
                "department_id": "D01",
            }
        ]
    )
    invoice = _invoice(
        vendor_id="V015",
        department_id="D01",
        line_items=[{"line_no": 1, "description": "Freight services Toronto"}],
    )

    with mock.patch(
        "automation.coding.OpenAI", side_effect=RuntimeError("no key")
    ):
        suggestions = suggest_coding(invoice, reference)

    assert suggestions[0]["suggested_gl_account"] is None
    assert "manual" in suggestions[0]["reason"].lower()


def test_coding_unknown_line_returns_explicit_null_suggestion():
    reference = _coding_reference(historical_lines=[])
    invoice = _invoice(
        department_id="D01",
        line_items=[{"line_no": 1, "description": "Mystery charge"}],
    )

    with mock.patch(
        "automation.coding.OpenAI", side_effect=RuntimeError("no key")
    ):
        suggestions = suggest_coding(invoice, reference)

    assert len(suggestions) == 1
    assert suggestions[0]["line_no"] == 1
    assert suggestions[0]["suggested_gl_account"] is None
    assert suggestions[0]["suggested_department_id"] == "D01"
    assert suggestions[0]["confidence"] is None
    assert "review" in suggestions[0]["reason"].lower()


def test_coding_rejects_invalid_ai_account():
    reference = _coding_reference(historical_lines=[])
    invoice = _invoice(
        line_items=[{"line_no": 1, "description": "Mystery charge"}]
    )
    payload = {
        "suggestions": [
            {
                "line_no": 1,
                "account_number": "9999",
                "department_id": "D01",
                "confidence": "0.9",
                "reason": "Invented account",
            }
        ]
    }

    with mock.patch("automation.coding.OpenAI", _fake_ai(payload)):
        suggestions = suggest_coding(invoice, reference)

    assert suggestions[0]["suggested_gl_account"] is None


def test_coding_accepts_valid_ai_suggestion_and_validates_department():
    reference = _coding_reference(historical_lines=[])
    invoice = _invoice(
        department_id="D01",
        line_items=[{"line_no": 1, "description": "Mystery charge"}],
    )
    payload = {
        "suggestions": [
            {
                "line_no": 1,
                "account_number": "6110",
                "department_id": "D99",
                "confidence": "87",
                "reason": "Looks like software",
            }
        ]
    }

    with mock.patch("automation.coding.OpenAI", _fake_ai(payload)):
        suggestions = suggest_coding(invoice, reference)

    assert suggestions[0]["suggested_gl_account"] == "6110"
    assert suggestions[0]["suggested_department_id"] == "D01"
    assert suggestions[0]["confidence"] == "0.87"
    assert suggestions[0]["reason"] == "Looks like software"


def test_coding_provider_error_keeps_historical_suggestions():
    invoice = _invoice(
        line_items=[
            {"line_no": 1, "description": "Freight services Toronto"},
            {"line_no": 2, "description": "Mystery charge"},
        ]
    )

    with mock.patch(
        "automation.coding.OpenAI", side_effect=RuntimeError("no key")
    ):
        suggestions = suggest_coding(invoice, _coding_reference())

    assert suggestions[0]["suggested_gl_account"] == "5010"
    assert suggestions[1]["suggested_gl_account"] is None


def test_coding_history_department_falls_back_to_invoice_department():
    reference = _coding_reference(
        historical_lines=[
            {
                "invoice_id": "AP-00001",
                "vendor_id": "V015",
                "description": "Freight services Toronto",
                "gl_account": "5010",
                "department_id": "D99",
            }
        ]
    )
    invoice = _invoice(
        department_id="D01",
        line_items=[{"line_no": 1, "description": "Freight services Toronto"}],
    )

    suggestions = suggest_coding(invoice, reference)

    assert suggestions[0]["suggested_gl_account"] == "5010"
    assert suggestions[0]["suggested_department_id"] == "D01"


def test_coding_without_lines_returns_empty():
    assert suggest_coding(_invoice(), _coding_reference()) == []


def test_coding_rejects_unvalidated_invoice_department():
    reference = _coding_reference(
        historical_lines=[
            {
                "invoice_id": "AP-00001",
                "vendor_id": "V015",
                "description": "Freight services Toronto",
                "gl_account": "5010",
                "department_id": "D99",
            }
        ]
    )
    invoice = _invoice(
        department_id="D99",
        line_items=[{"line_no": 1, "description": "Freight services Toronto"}],
    )

    suggestions = suggest_coding(invoice, reference)

    assert suggestions[0]["suggested_gl_account"] == "5010"
    assert suggestions[0]["suggested_department_id"] is None


def test_coding_emits_one_entry_per_input_line_with_duplicate_numbers():
    invoice = _invoice(
        line_items=[
            {"line_no": 1, "description": "Freight services Toronto"},
            {"line_no": 1, "description": "Freight services Toronto"},
        ]
    )

    suggestions = suggest_coding(invoice, _coding_reference())

    assert len(suggestions) == 2
    assert [row["line_no"] for row in suggestions] == [1, 1]
    assert all(row["suggested_gl_account"] == "5010" for row in suggestions)


def test_coding_missing_line_no_does_not_collapse_explicit_line():
    invoice = _invoice(
        line_items=[
            {"description": "Freight services Toronto"},
            {
                "line_no": 1,
                "description": "Cloudbarn Workspace subscription (24 seats)",
            },
        ]
    )

    suggestions = suggest_coding(invoice, _coding_reference())

    assert len(suggestions) == 2
    assert [row["suggested_gl_account"] for row in suggestions] == [
        "5010",
        "6110",
    ]


def test_coding_blank_line_never_uses_ai():
    reference = _coding_reference(historical_lines=[])
    invoice = _invoice(
        line_items=[{"line_no": 1, "description": ""}]
    )
    payload = {
        "suggestions": [
            {
                "line_no": 1,
                "account_number": "6110",
                "department_id": "D01",
                "confidence": "0.9",
                "reason": "Guess",
            }
        ]
    }
    fake_client = mock.MagicMock()
    fake_client.return_value.responses.create.return_value = SimpleNamespace(
        output_text=json.dumps(payload)
    )

    with mock.patch("automation.coding.OpenAI", fake_client):
        suggestions = suggest_coding(invoice, reference)

    assert fake_client.call_count == 0
    assert suggestions[0]["suggested_gl_account"] is None
    assert "review" in suggestions[0]["reason"].lower()


def test_coding_account_type_check_is_case_insensitive():
    for account_type in ("Expense", " expense "):
        reference = _coding_reference(
            gl_accounts=[
                {
                    "account_number": "5010",
                    "name": "Freight",
                    "account_type": account_type,
                }
            ]
        )
        invoice = _invoice(
            line_items=[
                {"line_no": 1, "description": "Freight services Toronto"}
            ]
        )
        suggestions = suggest_coding(invoice, reference)
        assert suggestions[0]["suggested_gl_account"] == "5010"


def test_coding_parses_json_with_surrounding_prose():
    reference = _coding_reference(historical_lines=[])
    invoice = _invoice(
        line_items=[{"line_no": 1, "description": "Mystery charge"}]
    )
    body = json.dumps(
        {
            "suggestions": [
                {
                    "line_no": 1,
                    "account_number": "6110",
                    "department_id": "D01",
                    "confidence": "0.8",
                    "reason": "Looks like software",
                }
            ]
        }
    )

    class FakeResponses:
        def create(self, **kwargs):
            return SimpleNamespace(
                output_text=f"Here you go:\n```json\n{body}\n```\nThanks"
            )

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.responses = FakeResponses()

    with mock.patch("automation.coding.OpenAI", FakeClient):
        suggestions = suggest_coding(invoice, reference)

    assert suggestions[0]["suggested_gl_account"] == "6110"
