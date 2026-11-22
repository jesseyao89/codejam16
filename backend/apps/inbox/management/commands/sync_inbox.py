"""Sync the AP inbox and ingest invoice attachments (synchronous; calls the AI).

Useful for seeding the demo database before a presentation:

    uv run python manage.py sync_inbox --user U004
"""

from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User
from apps.inbox.services import sync_inbox


class Command(BaseCommand):
    help = "Sync the AP inbox and ingest invoice attachments (synchronous)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--user",
            default=None,
            help="AP user_id to attribute the actions to (default: first AP Clerk).",
        )

    def handle(self, *args, **options):
        if options["user"]:
            actor = User.objects.filter(user_id=options["user"]).first()
        else:
            actor = (
                User.objects.filter(
                    role=User.Role.AP_CLERK, status=User.Status.ACTIVE
                )
                .order_by("user_id")
                .first()
            )
        allowed = {"AP_CLERK", "FINANCE_MANAGER", "CONTROLLER"}
        if actor is None or actor.role not in allowed:
            raise CommandError(
                "Actor must be an AP Clerk, Finance Manager, or Controller."
            )

        counts = sync_inbox(actor)
        self.stdout.write(
            self.style.SUCCESS(
                f"Sync complete: ingested={counts['ingested']} "
                f"skipped={counts['skipped']} routed={counts['routed']}"
            )
        )
