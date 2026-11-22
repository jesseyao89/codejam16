from django.db import models


class GLAccount(models.Model):
    """Chart of accounts entry (gl_accounts.csv)."""

    account_number = models.CharField(max_length=20, primary_key=True)
    name = models.CharField(max_length=100)
    account_type = models.CharField(max_length=20, blank=True, default="")
    notes = models.CharField(max_length=255, blank=True, default="")

    def __str__(self) -> str:
        return f"{self.account_number} {self.name}"


class TaxCode(models.Model):
    """Canadian sales tax code (tax_codes.csv)."""

    code = models.CharField(max_length=16, primary_key=True)
    description = models.CharField(max_length=100, blank=True, default="")
    rate = models.DecimalField(max_digits=8, decimal_places=5, null=True, blank=True)
    applies_to = models.CharField(max_length=16, blank=True, default="")
    recoverable = models.CharField(max_length=8, blank=True, default="")
    gl_account = models.CharField(max_length=20, blank=True, default="")

    def __str__(self) -> str:
        return self.code


class FXRate(models.Model):
    """Daily USD->CAD rate (fx_rates.csv)."""

    date = models.DateField(primary_key=True)
    usd_to_cad = models.DecimalField(max_digits=12, decimal_places=6)

    def __str__(self) -> str:
        return f"{self.date} {self.usd_to_cad}"


class Invoice(models.Model):
    """An AP invoice (invoices.csv + incoming analysis results).

    ``status`` follows the workflow in AGENTS.md §5. Historical rows carry the
    equivalent of the dataset's lowercase statuses (mapped in ``load_dataset``).
    """

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        REVIEW = "REVIEW", "Review"
        PENDING_APPROVAL = "PENDING_APPROVAL", "Pending approval"
        APPROVED = "APPROVED", "Approved"
        SCHEDULED = "SCHEDULED", "Payment scheduled"
        PAID = "PAID", "Paid"
        REJECTED = "REJECTED", "Rejected"

    invoice_id = models.CharField(max_length=32, primary_key=True)
    vendor = models.ForeignKey(
        "vendors.Vendor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoices",
    )
    vendor_invoice_number = models.CharField(max_length=64, blank=True, default="")
    invoice_date = models.DateField(null=True, blank=True)
    received_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    currency = models.CharField(max_length=3, blank=True, default="")
    subtotal = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    gst_hst_amount = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    pst_qst_amount = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    total = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    fx_rate_to_cad = models.DecimalField(
        max_digits=12, decimal_places=6, null=True, blank=True
    )
    total_cad = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoices",
    )
    requester = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="requested_invoices",
    )
    po = models.ForeignKey(
        "vendors.PurchaseOrder",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoices",
    )
    contract = models.ForeignKey(
        "vendors.Contract",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoices",
    )
    ship_to_province = models.CharField(max_length=2, blank=True, default="")
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.DRAFT, db_index=True
    )

    # Analysis results (canonical envelope from AGENTS.md §7).
    raw_extraction = models.JSONField(default=dict, blank=True)
    validation_status = models.CharField(max_length=16, blank=True, default="")
    findings = models.JSONField(default=list, blank=True)
    coding_suggestions = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return self.invoice_id


class InvoiceLine(models.Model):
    """A line on an invoice (invoice_lines.csv)."""

    invoice = models.ForeignKey(
        Invoice, on_delete=models.CASCADE, related_name="lines"
    )
    line_no = models.IntegerField()
    description = models.CharField(max_length=255, blank=True, default="")
    quantity = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    unit_price = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    gl_account = models.ForeignKey(
        GLAccount, null=True, blank=True, on_delete=models.SET_NULL
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoice_lines",
    )
    gst_hst_code = models.CharField(max_length=16, blank=True, default="")
    pst_qst_code = models.CharField(max_length=16, blank=True, default="")
    line_type = models.CharField(max_length=16, blank=True, default="")

    class Meta:
        ordering = ("invoice", "line_no")
        unique_together = (("invoice", "line_no"),)

    def __str__(self) -> str:
        return f"{self.invoice_id} #{self.line_no}"
