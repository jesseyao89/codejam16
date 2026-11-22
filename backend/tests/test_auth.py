"""Auth + demo-password behaviour (docs/API_CONTRACT.md §2, docs/DEMO_USERS.md)."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

User = get_user_model()


@pytest.fixture
def approver(db):
    return User.objects.create_user(
        username="U007",
        user_id="U007",
        password="demo1234",
        first_name="Dev",
        last_name="Malhotra",
        role=User.Role.APPROVER,
        status=User.Status.ACTIVE,
    )


def _login(client, username="U007", password="demo1234"):
    return client.post(
        "/api/auth/login/",
        {"username": username, "password": password},
        format="json",
    )


@pytest.mark.django_db
def test_login_returns_token_and_user(approver):
    response = _login(APIClient())

    assert response.status_code == 200
    assert response.data["token"]
    assert response.data["user"]["id"] == "U007"
    assert response.data["user"]["username"] == "U007"
    assert response.data["user"]["full_name"] == "Dev Malhotra"
    assert response.data["user"]["role"] == "APPROVER"
    assert "password" not in response.data["user"]


@pytest.mark.django_db
def test_login_is_idempotent(approver):
    first = _login(APIClient()).data["token"]
    second = _login(APIClient()).data["token"]
    assert first == second


@pytest.mark.django_db
def test_login_rejects_bad_password_with_envelope(approver):
    response = _login(APIClient(), password="wrong")

    assert response.status_code == 401
    error = response.data["error"]
    assert error["code"] == "UNAUTHENTICATED"
    assert set(error) == {"code", "message", "details"}


@pytest.mark.django_db
def test_login_rejects_terminated_user(approver):
    approver.status = User.Status.TERMINATED
    approver.is_active = False
    approver.save(update_fields=["status", "is_active"])

    response = _login(APIClient())

    assert response.status_code == 401
    assert response.data["error"]["code"] == "UNAUTHENTICATED"


@pytest.mark.django_db
def test_me_requires_authentication(approver):
    response = APIClient().get("/api/auth/me/")

    assert response.status_code == 401
    assert response.data["error"]["code"] == "UNAUTHENTICATED"


@pytest.mark.django_db
def test_me_returns_current_user_with_bearer_token(approver):
    token = Token.objects.create(user=approver)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.key}")

    response = client.get("/api/auth/me/")

    assert response.status_code == 200
    assert response.data["id"] == "U007"
    assert response.data["username"] == "U007"
    assert response.data["role"] == "APPROVER"


@pytest.mark.django_db
def test_logout_deletes_token(approver):
    token = Token.objects.create(user=approver)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.key}")

    response = client.post("/api/auth/logout/")

    assert response.status_code == 204
    assert not Token.objects.filter(user=approver).exists()

    follow_up = client.get("/api/auth/me/")
    assert follow_up.status_code == 401
