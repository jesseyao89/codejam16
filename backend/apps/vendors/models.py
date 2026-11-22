from django.db import models


class Vendor(models.Model):
    """Vendor master (vendors.csv).

    Bank details are stored here but must be masked in the UI/logs and are only
    ever changed as a controlled action (AGENTS.md §8, §9).
    """

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ON_HOLD = "on_hold", "On hold"
        PENDING_REVIEW = "pending_review", "Pending review"

    vendor_id = models.CharField(max_length=16, primary_key=True)
    legal_name = models.CharField(max_length=200)
    category = models.CharField(max_length=100, blank=True, default="")
    default_gl_account = models.CharField(max_length=20, blank=True, default="")
    address = models.CharField(max_length=255, blank=True, default="")
    province_or_state = models.CharField(max_length=2, blank=True, default="")
    country = models.CharField(max_length=2, blank=True, default="")
    gst_hst_number = models.CharField(max_length=32, blank=True, default="")
    qst_number = models.CharField(max_length=32, blank=True, default="")
    payment_terms_days = models.IntegerField(null=True, blank=True)
    early_pay_discount = models.CharField(max_length=32, blank=True, default="")
    preferred_payment_method = models.CharField(max_length=16, blank=True, default="")
    accepts_card_payment = models.CharField(max_length=3, blank=True, default="")
    bank_institution = models.CharField(max_length=8, blank=True, default="")
    bank_transit = models.CharField(max_length=8, blank=True, default="")
    bank_account = models.CharField(max_length=32, blank=True, default="")
    bank_details_updated_at = models.DateField(null=True, blank=True)
    ap_contact_email = models.CharField(max_length=255, blank=True, default="")
    requires_po = models.CharField(max_length=3, blank=True, default="")
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PENDING_REVIEW
    )
    onboarded_at = models.DateField(null=True, blank=True)

    def __str__(self) -> str:
        return f"{self.vendor_id} {self.legal_name}"


class Contract(models.Model):
    """Supplier contract (contracts.csv)."""

    contract_id = models.CharField(max_length=16, primary_key=True)
    vendor = models.ForeignKey(
        Vendor, on_delete=models.CASCADE, related_name="contracts"
    )
    description = models.CharField(max_length=255, blank=True, default="")
    billing_type = models.CharField(max_length=32, blank=True, default="")
    monthly_fee = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    currency = models.CharField(max_length=3, blank=True, default="")
    hourly_rate_cap = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    fuel_surcharge_cap_pct = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True
    )
    not_to_exceed_monthly = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    auto_renew = models.CharField(max_length=3, blank=True, default="")
    status = models.CharField(max_length=16, blank=True, default="")

    def __str__(self) -> str:
        return f"{self.contract_id} ({self.vendor_id})"


class PurchaseOrder(models.Model):
    """Purchase order (purchase_orders.csv)."""

    po_id = models.CharField(max_length=20, primary_key=True)
    vendor = models.ForeignKey(
        Vendor, on_delete=models.CASCADE, related_name="purchase_orders"
    )
    department = models.ForeignKey(
        "accounts.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="purchase_orders",
    )
    requester = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="requested_pos",
    )
    issue_date = models.DateField(null=True, blank=True)
    description = models.CharField(max_length=255, blank=True, default="")
    total_amount = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    currency = models.CharField(max_length=3, blank=True, default="")
    status = models.CharField(max_length=32, blank=True, default="")
    approved_by = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="approved_pos",
    )

    def __str__(self) -> str:
        return self.po_id


class BankChange(models.Model):
    """Dated change to a vendor's bank details (bank_change_history.csv)."""

    change_id = models.CharField(max_length=16, primary_key=True)
    vendor = models.ForeignKey(
        Vendor, on_delete=models.CASCADE, related_name="bank_changes"
    )
    changed_at = models.DateField(null=True, blank=True)
    changed_by = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="bank_changes_made",
    )
    request_channel = models.CharField(max_length=32, blank=True, default="")
    verified_by_callback = models.CharField(max_length=3, blank=True, default="")
    old_account_last4 = models.CharField(max_length=4, blank=True, default="")
    new_account_last4 = models.CharField(max_length=4, blank=True, default="")

    def __str__(self) -> str:
        return self.change_id
