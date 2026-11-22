"""Seed structured approval policies (idempotent; never overwrites edits)."""

from django.core.management.base import BaseCommand

from apps.approvals.models import ApprovalPolicy

# Mirrors the semantics of the dataset's prose approval_policies.csv (P01-P06).
# ``cfo`` in P04 maps to CONTROLLER: the six-role model has no separate CFO.
POLICIES = [
    {
        "rule_id": "POL-P01",
        "name": "Up to 10,000 CAD",
        "priority": 10,
        "conditions": {
            "match": "all",
            "rules": [
                {"field": "invoice.total_cad", "op": "lte", "value": "10000"}
            ],
        },
        "steps": [
            {"step_no": 1, "role": "APPROVER", "approver_id": None},
        ],
    },
    {
        "rule_id": "POL-P02",
        "name": "Over 10,000 CAD",
        "priority": 20,
        "conditions": {
            "match": "all",
            "rules": [
                {"field": "invoice.total_cad", "op": "gt", "value": "10000"}
            ],
        },
        "steps": [
            {"step_no": 1, "role": "APPROVER", "approver_id": None},
            {"step_no": 2, "role": "FINANCE_MANAGER", "approver_id": None},
        ],
    },
    {
        "rule_id": "POL-P03",
        "name": "Over 50,000 CAD",
        "priority": 30,
        "conditions": {
            "match": "all",
            "rules": [
                {"field": "invoice.total_cad", "op": "gt", "value": "50000"}
            ],
        },
        "steps": [
            {"step_no": 1, "role": "APPROVER", "approver_id": None},
            {"step_no": 2, "role": "FINANCE_MANAGER", "approver_id": None},
            {"step_no": 3, "role": "CONTROLLER", "approver_id": None},
        ],
    },
    {
        "rule_id": "POL-P04",
        "name": "Over 250,000 CAD",
        "priority": 40,
        "conditions": {
            "match": "all",
            "rules": [
                {"field": "invoice.total_cad", "op": "gt", "value": "250000"}
            ],
        },
        "steps": [
            {"step_no": 1, "role": "APPROVER", "approver_id": None},
            {"step_no": 2, "role": "FINANCE_MANAGER", "approver_id": None},
            {"step_no": 3, "role": "CONTROLLER", "approver_id": None},
        ],
    },
    {
        "rule_id": "POL-P05",
        "name": "New or pending vendor",
        "priority": 50,
        "conditions": {
            "match": "any",
            "rules": [
                {
                    "field": "vendor.status",
                    "op": "eq",
                    "value": "pending_review",
                },
                {"field": "vendor.is_new", "op": "eq", "value": True},
            ],
        },
        "steps": [
            {"step_no": 1, "role": "FINANCE_MANAGER", "approver_id": None},
        ],
    },
    {
        "rule_id": "POL-P06",
        "name": "Legal vendor",
        "priority": 60,
        "conditions": {
            "match": "all",
            "rules": [
                {"field": "vendor.category", "op": "eq", "value": "Legal"}
            ],
        },
        "steps": [
            {"step_no": 1, "role": "FINANCE_MANAGER", "approver_id": None},
        ],
    },
]


class Command(BaseCommand):
    help = "Seed structured approval policies (idempotent; won't overwrite)."

    def handle(self, *args, **options):
        created = 0
        for spec in POLICIES:
            _, was_created = ApprovalPolicy.objects.get_or_create(
                rule_id=spec["rule_id"],
                defaults={
                    "rule_type": "approval",
                    "name": spec["name"],
                    "priority": spec["priority"],
                    "active": True,
                    "conditions": spec["conditions"],
                    "steps": spec["steps"],
                    "notes": "Seeded from approval_policies.csv semantics",
                },
            )
            created += int(was_created)

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {created} policy(ies); {len(POLICIES) - created} already existed."
            )
        )
