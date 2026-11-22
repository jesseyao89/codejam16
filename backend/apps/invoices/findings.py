"""Deterministic finding IDs and validation-status computation (contract §5.3)."""

from __future__ import annotations

import hashlib
import json


def finding_id(code: str, evidence: dict | None) -> str:
    """A stable id for a finding, derived from its code + evidence."""
    payload = json.dumps(
        {"code": code, "evidence": evidence or {}},
        sort_keys=True,
        default=str,
    )
    digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()
    return f"F-{digest[:12]}"


def attach_finding_ids(findings: list) -> list:
    """Return a copy of ``findings`` with ``finding_id`` and ``resolution`` set.

    Idempotent: the id is deterministic, and ``resolution`` is only defaulted,
    never overwritten.
    """
    out = []
    for finding in findings or []:
        item = dict(finding)
        item["finding_id"] = finding_id(
            item.get("code"), item.get("evidence")
        )
        item.setdefault("resolution", None)
        out.append(item)
    return out


def compute_validation_status(findings: list) -> str:
    """Compute ``validation_status`` from *open* findings only."""
    open_findings = [
        finding for finding in findings if finding.get("resolution") is None
    ]
    if any(f.get("severity") == "BLOCK" for f in open_findings):
        return "BLOCKED"
    if any(f.get("severity") == "WARNING" for f in open_findings):
        return "WARNING"
    return "PASSED"
