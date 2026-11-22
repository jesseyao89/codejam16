"""Backfill missing CAD amounts on invoices (idempotent).

New uploads set ``total_cad``/``fx_rate_to_cad``; this repairs rows created
before that fix. It never invents an FX rate: USD invoices without a matching
invoice-date rate are skipped and reported.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand

from apps.invoices.models import FXRate, Invoice


class Command(BaseCommand):
    help = "Backfill missing total_cad/fx_rate_to_cad on invoices (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change without writing.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        updated = 0
        skipped = 0

        for invoice in Invoice.objects.filter(total_cad__isnull=True):
            if invoice.total is None:
                skipped += 1
                continue

            if invoice.currency == "CAD":
                invoice.total_cad = invoice.total
                invoice.fx_rate_to_cad = Decimal("1.0")
            elif invoice.currency == "USD" and invoice.invoice_date is not None:
                rate = FXRate.objects.filter(date=invoice.invoice_date).first()
                if rate is None:
                    skipped += 1
                    continue
                invoice.fx_rate_to_cad = rate.usd_to_cad
                invoice.total_cad = (invoice.total * rate.usd_to_cad).quantize(
                    Decimal("0.01")
                )
            else:
                skipped += 1
                continue

            if not dry_run:
                invoice.save(update_fields=["total_cad", "fx_rate_to_cad"])
            updated += 1

        verb = "Would update" if dry_run else "Updated"
        self.stdout.write(
            self.style.SUCCESS(f"{verb} {updated} invoice(s); skipped {skipped}.")
        )
