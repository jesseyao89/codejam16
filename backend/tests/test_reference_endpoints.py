import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.accounts.models import Department
from apps.invoices.models import GLAccount, TaxCode
from apps.vendors.models import BankChange, Vendor

User = get_user_model()


@pytest.fixture
def authenticated_client(db):
    user = User.objects.create_user(
        username="picker-user",
        user_id="U-PICKER",
        password="demo1234",
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def vendor(db):
    return Vendor.objects.create(
        vendor_id="V-TEST",
        legal_name="Example Freight Ltd.",
        category="Freight",
        status=Vendor.Status.ACTIVE,
        bank_institution="001",
        bank_account="1234567890124821",
    )


@pytest.mark.django_db
def test_reference_and_vendor_lists_use_pagination_envelope(
    authenticated_client, vendor
):
    Department.objects.create(
        department_id="D-TEST",
        name="Operations",
        cost_centre="1100",
        annual_budget_cad="1800000.00",
    )
    GLAccount.objects.create(
        account_number="5010",
        name="Freight",
        account_type="expense",
        notes="",
    )
    TaxCode.objects.create(code="GST5", rate="0.05")

    for path in (
        "/api/departments/",
        "/api/gl-accounts/",
        "/api/tax-codes/",
        "/api/vendors/",
    ):
        response = authenticated_client.get(path)

        assert response.status_code == 200
        assert set(response.data) == {"count", "next", "previous", "results"}
        assert response.data["count"] == 1


@pytest.mark.django_db
def test_reference_and_vendor_filters(authenticated_client):
    GLAccount.objects.create(
        account_number="5010", name="Freight", account_type="expense"
    )
    GLAccount.objects.create(
        account_number="1010", name="Cash", account_type="asset"
    )
    freight = Vendor.objects.create(
        vendor_id="V-FREIGHT",
        legal_name="North Freight",
        category="Freight",
        status=Vendor.Status.ACTIVE,
    )
    Vendor.objects.create(
        vendor_id="V-HOLD",
        legal_name="North Supplies",
        category="Supplies",
        status=Vendor.Status.ON_HOLD,
    )

    gl_response = authenticated_client.get("/api/gl-accounts/?account_type=expense")
    assert [row["account_number"] for row in gl_response.data["results"]] == ["5010"]

    search_response = authenticated_client.get("/api/vendors/?q=freight")
    assert [row["id"] for row in search_response.data["results"]] == [freight.vendor_id]

    category_response = authenticated_client.get("/api/vendors/?category=Freight")
    assert [row["id"] for row in category_response.data["results"]] == [
        freight.vendor_id
    ]

    status_response = authenticated_client.get("/api/vendors/?status=on_hold")
    assert [row["id"] for row in status_response.data["results"]] == ["V-HOLD"]


@pytest.mark.django_db
def test_vendor_detail_masks_bank_account(authenticated_client, vendor):
    response = authenticated_client.get(f"/api/vendors/{vendor.vendor_id}/")

    assert response.status_code == 200
    assert response.data["bank_account_masked"] == "**** 4821"
    assert response.data["bank_institution"] == "***"
    assert "bank_account" not in response.data
    assert vendor.bank_account not in str(response.data)


@pytest.mark.django_db
def test_bank_changes_are_nested_with_contract_shape_and_unavailable_state_null(
    authenticated_client, vendor
):
    BankChange.objects.create(
        change_id="BC-TEST",
        vendor=vendor,
        request_channel="email_request",
        verified_by_callback="no",
        old_account_last4="4821",
        new_account_last4="9933",
    )

    response = authenticated_client.get(
        f"/api/vendors/{vendor.vendor_id}/bank-changes/"
    )

    assert response.status_code == 200
    assert response.data["count"] == 1
    change = response.data["results"][0]
    assert set(change) == {
        "id",
        "vendor_id",
        "status",
        "changed_at",
        "requested_by_id",
        "request_channel",
        "verified_by_callback",
        "old_account_last4",
        "new_account_last4",
        "decided_by_id",
        "decided_at",
    }
    assert change["id"] == "BC-TEST"
    assert change["vendor_id"] == vendor.vendor_id
    assert change["status"] is None
    assert change["decided_by_id"] is None
    assert change["decided_at"] is None


@pytest.mark.django_db
def test_missing_vendor_uses_not_found_error_envelope(authenticated_client):
    response = authenticated_client.get("/api/vendors/UNKNOWN/")

    assert response.status_code == 404
    assert response.data["error"]["code"] == "NOT_FOUND"


@pytest.mark.django_db
def test_pagination_links_are_relative(authenticated_client):
    for vendor_id in ("V-001", "V-002"):
        Vendor.objects.create(vendor_id=vendor_id, legal_name=vendor_id)

    first_page = authenticated_client.get("/api/vendors/?page_size=1")
    second_page = authenticated_client.get("/api/vendors/?page_size=1&page=2")

    assert first_page.data["next"].startswith("/api/vendors/?")
    assert "page=2" in first_page.data["next"]
    assert second_page.data["previous"].startswith("/api/vendors/?")
    assert "page_size=1" in second_page.data["previous"]


@pytest.mark.django_db
def test_pagination_defaults_to_25_and_caps_page_size_at_100(authenticated_client):
    Vendor.objects.bulk_create(
        [
            Vendor(vendor_id=f"V-{index:03}", legal_name=f"Vendor {index}")
            for index in range(101)
        ]
    )

    default_page = authenticated_client.get("/api/vendors/")
    capped_page = authenticated_client.get("/api/vendors/?page_size=101")

    assert len(default_page.data["results"]) == 25
    assert len(capped_page.data["results"]) == 100


@pytest.mark.django_db
def test_reference_endpoints_require_authentication():
    response = APIClient().get("/api/departments/")

    assert response.status_code == 401
    assert response.data["error"]["code"] == "UNAUTHENTICATED"
