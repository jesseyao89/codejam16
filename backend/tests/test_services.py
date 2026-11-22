"""Integration tests for the service layer that feeds the pure automation.

These exercise the real ORM -> ``automation`` dict boundary, which the unit
tests in ``test_automation.py`` bypass by hand-building reference data.
"""

from datetime import date
from decimal import Decimal

import pytest

from apps.invoices.models import Invoice
from apps.invoices.services import build_reference_data
from apps.payments.models import Payment
from apps.vendors.models import Vendor
from automation.duplicates import detect_duplicates


def _historical_invoice(**overrides):
    vendor = Vendor.objects.create(
        vendor_id="V015", legal_name="Polar Freight Lines Ltd."
    )
    values = dict(
        invoice_id="AP-00001",
        vendor=vendor,
        vendor_invoice_number="INV-100",
        invoice_date=date(2026, 9, 29),
        currency="CAD",
        total=Decimal("105.00"),
        status=Invoice.Status.PAID,
    )
    values.update(overrides)
    return Invoice.objects.create(**values)


@pytest.mark.django_db
def test_reference_data_includes_duplicate_matching_fields():
    invoice = _historical_invoice()
    Payment.objects.create(
        payment_id="PAY-00001",
        invoice=invoice,
        method="CARD",
        status=Payment.Status.SETTLED,
    )

    row = build_reference_data()["historical_invoices"][0]

    assert row["total"] == "105.00"
    assert row["currency"] == "CAD"
    assert row["invoice_date"] == "2026-09-29"
    assert row["payment_method"] == "CARD"


@pytest.mark.django_db
def test_near_duplicate_detected_through_service_layer():
    invoice = _historical_invoice()
    Payment.objects.create(
        payment_id="PAY-00001",
        invoice=invoice,
        method="CARD",
        status=Payment.Status.SETTLED,
    )

    incoming = {
        "vendor_id": "V015",
        "invoice_number": "INV-200",
        "invoice_date": "2026-10-01",
        "currency": "CAD",
        "total": "105.00",
    }
    findings = detect_duplicates(incoming, build_reference_data()["historical_invoices"])

    assert any(
        f["code"] == "POSSIBLE_DUPLICATE"
        and f["severity"] == "WARNING"
        and f["evidence"].get("paid_by") == "CARD"
        for f in findings
    )


@pytest.mark.django_db
def test_exact_duplicate_detected_through_service_layer():
    _historical_invoice()
    incoming = {
        "vendor_id": "V015",
        "invoice_number": "inv 100",  # reformatted vs stored INV-100
        "invoice_date": "2026-10-01",
        "currency": "CAD",
        "total": "105.00",
    }
    findings = detect_duplicates(incoming, build_reference_data()["historical_invoices"])

    assert any(
        f["code"] == "EXACT_DUPLICATE" and f["severity"] == "BLOCK"
        for f in findings
    )
