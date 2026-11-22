"""Map DRF exceptions to the API contract's error envelope (AGENTS.md §7).

Every 4xx/5xx response must be::

    {"error": {"code": "...", "message": "...", "details": {}}}

so the frontend has a single error parser (docs/API_CONTRACT.md §1.2).
"""

from __future__ import annotations

import logging

from rest_framework.exceptions import AuthenticationFailed, NotAuthenticated
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)

# Status -> stable contract code. Unknown 4xx fall back to VALIDATION_ERROR.
_STATUS_CODES = {
    400: "VALIDATION_ERROR",
    401: "UNAUTHENTICATED",
    403: "PERMISSION_DENIED",
    404: "NOT_FOUND",
    405: "VALIDATION_ERROR",
    406: "VALIDATION_ERROR",
    409: "INVALID_STATE_TRANSITION",
    415: "VALIDATION_ERROR",
    422: "VALIDATION_BLOCKED",
    429: "VALIDATION_ERROR",
}


def _first_message(data, default: str = "Request failed.") -> str:
    """Pull a human-readable message out of a DRF error payload."""
    if isinstance(data, str):
        return data
    if isinstance(data, dict):
        for value in data.values():
            message = _first_message(value, "")
            if message:
                return message
    elif isinstance(data, (list, tuple)):
        for item in data:
            message = _first_message(item, "")
            if message:
                return message
    return default


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)

    if response is None:
        # Unhandled exception: log it, but never leak a traceback to the API.
        logger.exception("Unhandled API exception")
        return Response(
            {
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "An unexpected error occurred.",
                    "details": {},
                }
            },
            status=500,
        )

    # DRF downgrades 401 to 403 when no authentication class supplies a
    # WWW-Authenticate header. The contract requires 401/UNAUTHENTICATED for
    # bad credentials, so restore it here.
    if isinstance(exc, (AuthenticationFailed, NotAuthenticated)):
        response.status_code = 401

    code = (
        "INTERNAL_ERROR"
        if response.status_code >= 500
        else _STATUS_CODES.get(response.status_code, "VALIDATION_ERROR")
    )

    original = response.data
    details = original if isinstance(original, (dict, list)) else {}
    response.data = {
        "error": {
            "code": code,
            "message": _first_message(original),
            "details": details,
        }
    }
    return response
