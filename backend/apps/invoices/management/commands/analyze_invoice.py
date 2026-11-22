import json

from django.core.management.base import BaseCommand, CommandError

from apps.invoices.services import (
    build_reference_data,
    extraction_tax_codes,
    resolve_vendor,
)
from automation.extraction import extract_invoice
from automation.pipeline import analyze_invoice


class Command(BaseCommand):
    help = "Extract and analyze a single invoice file (PDF or image)."

    def add_arguments(self, parser):
        parser.add_argument("file_path", type=str, help="Path to the invoice file.")

    def handle(self, *args, **options):
        file_path = options["file_path"]
        try:
            extracted = extract_invoice(
                file_path, tax_codes=extraction_tax_codes()
            )
        except Exception as exc:  # noqa: BLE001 - surface a clean CLI error
            raise CommandError(f"Extraction failed: {exc}") from exc

        extracted = resolve_vendor(extracted)
        reference = build_reference_data()
        result = analyze_invoice(extracted, reference)

        self.stdout.write(json.dumps(result, indent=2, default=str))
