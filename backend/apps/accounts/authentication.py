"""Bearer token authentication matching the API contract."""

from rest_framework.authentication import TokenAuthentication


class BearerTokenAuthentication(TokenAuthentication):
    """Accept ``Authorization: Bearer <token>`` (docs/API_CONTRACT.md §2)."""

    keyword = "Bearer"
