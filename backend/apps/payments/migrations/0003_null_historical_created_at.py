from django.db import migrations

# Historical dataset rows predate the column; their true creation time is
# unknown, so leave it null rather than claiming the migration time.
HISTORICAL_STATUSES = ["outstanding", "scheduled", "settled"]


def null_historical_created_at(apps, schema_editor):
    Payment = apps.get_model("payments", "Payment")
    Payment.objects.filter(status__in=HISTORICAL_STATUSES).update(created_at=None)


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0002_payment_created_at"),
    ]

    operations = [
        migrations.RunPython(
            null_historical_created_at, migrations.RunPython.noop
        ),
    ]
