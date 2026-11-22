from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.invoices.loader import Loader


class Command(BaseCommand):
    help = "Idempotently load the Harborline AP dataset into the database."

    def add_arguments(self, parser):
        parser.add_argument(
            "--data-dir",
            type=str,
            default=None,
            help="Override DATA_DIR (defaults to settings.DATA_DIR).",
        )

    def handle(self, *args, **options):
        data_dir = options["data_dir"] or settings.DATA_DIR
        if not data_dir.exists():
            raise CommandError(f"DATA_DIR not found: {data_dir}")

        loader = Loader(data_dir)
        counts = loader.run()

        self.stdout.write(self.style.SUCCESS("Loaded tables:"))
        for table, count in counts.items():
            self.stdout.write(f"  {table}: {count} rows")

        if loader.errors:
            self.stderr.write(
                self.style.ERROR(f"{len(loader.errors)} row-level error(s):")
            )
            for table, key, msg in loader.errors:
                self.stderr.write(f"  [{table}] {key}: {msg}")
            raise SystemExit(1)

        self.stdout.write(self.style.SUCCESS("Dataset loaded with no errors."))
