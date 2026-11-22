from django.db import models


class Payment(models.Model):
    """A (simulated) supplier payment (payments.csv + workflow).

    Historical rows carry the dataset's lowercase statuses; new payments follow
    the AGENTS.md §5 states PREPARED/SCHEDULED/RELEASED/PAID/FAILED/CANCELLED.
    """

    class Status(models.TextChoices):
        # Historical dataset statuses
        OUTSTANDING = "outstanding", "Outstanding"
        SCHEDULED = "scheduled", "Scheduled"
        SETTLED = "settled", "Settled"
        # New-payment workflow statuses
        PREPARED = "PREPARED", "Prepared"
        RELEASED = "RELEASED", "Released"
        PAID = "PAID", "Paid"
        FAILED = "FAILED", "Failed"
        CANCELLED = "CANCELLED", "Cancelled"

    payment_id = models.CharField(max_length=32, primary_key=True)
    invoice = models.ForeignKey(
        "invoices.Invoice",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payments",
    )
    vendor = models.ForeignKey(
        "vendors.Vendor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payments",
    )
    method = models.CharField(max_length=16, blank=True, default="")
    scheduled_date = models.DateField(null=True, blank=True)
    paid_date = models.DateField(null=True, blank=True)
    currency = models.CharField(max_length=3, blank=True, default="")
    amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    fx_rate_to_cad = models.DecimalField(
        max_digits=12, decimal_places=6, null=True, blank=True
    )
    amount_cad = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    discount_taken = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    reference = models.CharField(max_length=64, blank=True, default="")
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PREPARED, db_index=True
    )
    prepared_by = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="prepared_payments",
    )
    released_by = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="released_payments",
    )

    def __str__(self) -> str:
        return self.payment_id


class CardTransaction(models.Model):
    """A Brim card transaction (card_transactions.csv)."""

    txn_id = models.CharField(max_length=32, primary_key=True)
    card_id = models.CharField(max_length=32, blank=True, default="")
    cardholder = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="card_transactions",
    )
    posted_date = models.DateField(null=True, blank=True)
    merchant_descriptor = models.CharField(max_length=255, blank=True, default="")
    mcc = models.CharField(max_length=8, blank=True, default="")
    amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, blank=True, default="")
    amount_cad = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    source = models.CharField(max_length=32, blank=True, default="")
    receipt_attached = models.CharField(max_length=3, blank=True, default="")
    memo = models.CharField(max_length=255, blank=True, default="")

    def __str__(self) -> str:
        return self.txn_id


class BankStatement(models.Model):
    """A bank statement line (bank_statement.csv)."""

    bank_txn_id = models.CharField(max_length=32, primary_key=True)
    posted_date = models.DateField(null=True, blank=True)
    description = models.CharField(max_length=255, blank=True, default="")
    debit = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    credit = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )

    def __str__(self) -> str:
        return self.bank_txn_id
