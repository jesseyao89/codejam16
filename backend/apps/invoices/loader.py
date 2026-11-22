"""Load the Harborline AP dataset into the database (idempotent).

Reads the CSVs under ``settings.DATA_DIR / "data"`` and upserts each row keyed
on its natural string id. Row-level problems are recorded and reported rather
than aborting the load, so a bad row never crashes the whole import
(AGENTS.md §1, §8).
"""

from __future__ import annotations

import csv
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.db import transaction

from apps.accounts.models import Department, User
from apps.approvals.models import ApprovalPolicy, ApprovalStep
from apps.inbox.loader import load_emails
from apps.invoices.models import FXRate, GLAccount, Invoice, InvoiceLine, TaxCode
from apps.payments.models import BankStatement, CardTransaction, Payment
from apps.vendors.models import BankChange, Contract, PurchaseOrder, Vendor


# --- value coercion --------------------------------------------------------

def _empty(value):
    if value is None:
        return None
    s = str(value).strip()
    return s if s != "" else None


def _string(value, default=""):
    s = _empty(value)
    return default if s is None else s


def _decimal(value):
    s = _empty(value)
    if s is None:
        return None
    try:
        return Decimal(s)
    except InvalidOperation as exc:
        raise ValueError(f"invalid decimal: {value!r}") from exc


def _int(value):
    s = _empty(value)
    if s is None:
        return None
    return int(s)


def _date(value):
    s = _empty(value)
    if s is None:
        return None
    return date.fromisoformat(s)


def _datetime(value):
    s = _empty(value)
    if s is None:
        return None
    dt = datetime.fromisoformat(s)
    # The dataset's timestamps carry no tz offset; treat them as UTC so the
    # audit/approval timestamps are stored aware (AGENTS.md §7).
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


# --- enum mappings (dataset snake_case -> AGENTS.md canonical codes) --------

ROLE_MAP = {
    "employee": User.Role.EMPLOYEE,
    "ap_clerk": User.Role.AP_CLERK,
    "approver": User.Role.APPROVER,
    "finance_manager": User.Role.FINANCE_MANAGER,
    "controller_admin": User.Role.CONTROLLER,
    "auditor": User.Role.AUDITOR,
}


class Loader:
    """Stateful, idempotent loader. Keeps FK caches and an error log."""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.users: dict[str, User] = {}
        self.departments: dict[str, Department] = {}
        self.vendors: dict[str, Vendor] = {}
        self.errors: list[tuple[str, str, str]] = []

    # -- helpers -----------------------------------------------------------

    def rows(self, name: str) -> list[dict]:
        path = self.data_dir / "data" / f"{name}.csv"
        with path.open(newline="", encoding="utf-8-sig") as fh:
            return list(csv.DictReader(fh))

    def load(self, table: str, fn) -> int:
        rows = self.rows(table)
        for row in rows:
            try:
                fn(row)
            except Exception as exc:  # noqa: BLE001 - report and continue
                key = next(iter(row.values()), "?")
                self.errors.append((table, key, str(exc)))
        return len(rows)

    def fk(self, cache: dict, key):
        key = _empty(key)
        if key is None:
            return None
        if key not in cache:
            raise ValueError(f"missing reference: {key!r}")
        return cache[key]

    # -- loaders (called in dependency order) ------------------------------

    def load_departments(self):
        def fn(row):
            dep = Department.objects.update_or_create(
                department_id=row["department_id"],
                defaults={
                    "name": row["name"],
                    "cost_centre": _string(row.get("cost_centre")),
                    "annual_budget_cad": _decimal(row.get("annual_budget_cad")),
                },
            )[0]
            self.departments[dep.department_id] = dep

        return self.load("departments", fn)

    def load_users(self):
        # Every seeded user shares the same demo password, so hash it once per
        # run instead of re-hashing 40 times (PBKDF2 is deliberately slow).
        demo_hash = make_password(settings.DEMO_PASSWORD)

        def fn(row):
            user_id = row["user_id"]
            role = ROLE_MAP.get(row.get("role"))
            if role is None:
                raise ValueError(f"unknown role: {row.get('role')!r}")
            full_name = row["full_name"].strip()
            parts = full_name.split(" ", 1)
            first_name = parts[0]
            last_name = parts[1] if len(parts) > 1 else ""
            status = _string(row.get("status"), "active")

            user, created = User.objects.get_or_create(
                username=user_id,
                defaults={"user_id": user_id},
            )
            # Demo-only: every seeded user shares the documented fake password
            # (docs/DEMO_USERS.md, contract §2.1). Set it on create, or to
            # repair rows that still have an empty/unusable password.
            if created or not user.password or not user.has_usable_password():
                user.password = demo_hash
            user.user_id = user_id
            user.email = _string(row.get("email"))
            user.first_name = first_name
            user.last_name = last_name
            user.title = _string(row.get("title"))
            user.role = role
            user.department = self.fk(self.departments, row.get("department_id"))
            user.approval_limit_cad = _decimal(row.get("approval_limit_cad"))
            user.work_province = _string(row.get("work_province"))
            user.status = status
            user.status_since = _date(row.get("status_since"))
            user.hire_date = _date(row.get("hire_date"))
            user.is_active = status != User.Status.TERMINATED
            user.is_staff = role == User.Role.CONTROLLER
            user.save()
            self.users[user_id] = user

        return self.load("users", fn)

    def link_users(self):
        """Second pass: manager and delegate self-references."""
        for row in self.rows("users"):
            user = self.users.get(row["user_id"])
            if user is None:
                continue
            user.manager = self.fk(self.users, row.get("manager_id"))
            user.delegate = self.fk(self.users, row.get("delegate_user_id"))
            user.save(update_fields=["manager", "delegate"])

    def link_departments(self):
        for row in self.rows("departments"):
            dep = self.departments.get(row["department_id"])
            if dep is None:
                continue
            dep.manager = self.fk(self.users, row.get("manager_user_id"))
            dep.save(update_fields=["manager"])

    def load_vendors(self):
        def fn(row):
            vendor = Vendor.objects.update_or_create(
                vendor_id=row["vendor_id"],
                defaults={
                    "legal_name": row["legal_name"],
                    "category": _string(row.get("category")),
                    "default_gl_account": _string(row.get("default_gl_account")),
                    "address": _string(row.get("address")),
                    "province_or_state": _string(row.get("province_or_state")),
                    "country": _string(row.get("country")),
                    "gst_hst_number": _string(row.get("gst_hst_number")),
                    "qst_number": _string(row.get("qst_number")),
                    "payment_terms_days": _int(row.get("payment_terms_days")),
                    "early_pay_discount": _string(row.get("early_pay_discount")),
                    "preferred_payment_method": _string(
                        row.get("preferred_payment_method")
                    ),
                    "accepts_card_payment": _string(row.get("accepts_card_payment")),
                    "bank_institution": _string(row.get("bank_institution")),
                    "bank_transit": _string(row.get("bank_transit")),
                    "bank_account": _string(row.get("bank_account")),
                    "bank_details_updated_at": _date(
                        row.get("bank_details_updated_at")
                    ),
                    "ap_contact_email": _string(row.get("ap_contact_email")),
                    "requires_po": _string(row.get("requires_po")),
                    "status": _string(row.get("status"), "pending_review"),
                    "onboarded_at": _date(row.get("onboarded_at")),
                },
            )[0]
            self.vendors[vendor.vendor_id] = vendor

        return self.load("vendors", fn)

    def load_gl_accounts(self):
        def fn(row):
            GLAccount.objects.update_or_create(
                account_number=row["account_number"],
                defaults={
                    "name": row["name"],
                    "account_type": _string(row.get("account_type")),
                    "notes": _string(row.get("notes")),
                },
            )

        return self.load("gl_accounts", fn)

    def load_tax_codes(self):
        def fn(row):
            TaxCode.objects.update_or_create(
                code=row["code"],
                defaults={
                    "description": _string(row.get("description")),
                    "rate": _decimal(row.get("rate")),
                    "applies_to": _string(row.get("applies_to")),
                    "recoverable": _string(row.get("recoverable")),
                    "gl_account": _string(row.get("gl_account")),
                },
            )

        return self.load("tax_codes", fn)

    def load_fx_rates(self):
        def fn(row):
            FXRate.objects.update_or_create(
                date=_date(row["date"]),
                defaults={"usd_to_cad": _decimal(row["usd_to_cad"])},
            )

        return self.load("fx_rates", fn)

    def load_contracts(self):
        def fn(row):
            Contract.objects.update_or_create(
                contract_id=row["contract_id"],
                defaults={
                    "vendor": self.fk(self.vendors, row.get("vendor_id")),
                    "description": _string(row.get("description")),
                    "billing_type": _string(row.get("billing_type")),
                    "monthly_fee": _decimal(row.get("monthly_fee")),
                    "currency": _string(row.get("currency")),
                    "hourly_rate_cap": _decimal(row.get("hourly_rate_cap")),
                    "fuel_surcharge_cap_pct": _decimal(
                        row.get("fuel_surcharge_cap_pct")
                    ),
                    "not_to_exceed_monthly": _decimal(
                        row.get("not_to_exceed_monthly")
                    ),
                    "start_date": _date(row.get("start_date")),
                    "end_date": _date(row.get("end_date")),
                    "auto_renew": _string(row.get("auto_renew")),
                    "status": _string(row.get("status")),
                },
            )

        return self.load("contracts", fn)

    def load_purchase_orders(self):
        def fn(row):
            PurchaseOrder.objects.update_or_create(
                po_id=row["po_id"],
                defaults={
                    "vendor": self.fk(self.vendors, row.get("vendor_id")),
                    "department": self.fk(self.departments, row.get("department_id")),
                    "requester": self.fk(self.users, row.get("requester_user_id")),
                    "issue_date": _date(row.get("issue_date")),
                    "description": _string(row.get("description")),
                    "total_amount": _decimal(row.get("total_amount")),
                    "currency": _string(row.get("currency")),
                    "status": _string(row.get("status")),
                    "approved_by": self.fk(self.users, row.get("approved_by")),
                },
            )

        return self.load("purchase_orders", fn)

    def load_invoices(self):
        def fn(row):
            Invoice.objects.update_or_create(
                invoice_id=row["invoice_id"],
                defaults={
                    "vendor": self.fk(self.vendors, row.get("vendor_id")),
                    "vendor_invoice_number": _string(
                        row.get("vendor_invoice_number")
                    ),
                    "invoice_date": _date(row.get("invoice_date")),
                    "received_date": _date(row.get("received_date")),
                    "due_date": _date(row.get("due_date")),
                    "currency": _string(row.get("currency")),
                    "subtotal": _decimal(row.get("subtotal")),
                    "gst_hst_amount": _decimal(row.get("gst_hst_amount")),
                    "pst_qst_amount": _decimal(row.get("pst_qst_amount")),
                    "total": _decimal(row.get("total")),
                    "fx_rate_to_cad": _decimal(row.get("fx_rate_to_cad")),
                    "total_cad": _decimal(row.get("total_cad")),
                    "department": self.fk(self.departments, row.get("department_id")),
                    "requester": self.fk(self.users, row.get("requester_user_id")),
                    "po_id": _empty(row.get("po_id")),
                    "contract_id": _empty(row.get("contract_id")),
                    "ship_to_province": _string(row.get("ship_to_province")),
                    "status": _string(row.get("status"), "DRAFT").upper(),
                },
            )

        return self.load("invoices", fn)

    def load_invoice_lines(self):
        def fn(row):
            InvoiceLine.objects.update_or_create(
                invoice_id=row["invoice_id"],
                line_no=_int(row["line_no"]),
                defaults={
                    "description": _string(row.get("description")),
                    "quantity": _decimal(row.get("quantity")),
                    "unit_price": _decimal(row.get("unit_price")),
                    "amount": _decimal(row.get("amount")),
                    "gl_account_id": _empty(row.get("gl_account")),
                    "department": self.fk(self.departments, row.get("department_id")),
                    "gst_hst_code": _string(row.get("gst_hst_code")),
                    "pst_qst_code": _string(row.get("pst_qst_code")),
                    "line_type": _string(row.get("line_type")),
                },
            )

        return self.load("invoice_lines", fn)

    def load_approvals(self):
        approver_role_map = {
            "dept_manager": User.Role.APPROVER,
            "finance_manager": User.Role.FINANCE_MANAGER,
            "controller_admin": User.Role.CONTROLLER,
        }

        def fn(row):
            ApprovalStep.objects.update_or_create(
                approval_id=row["approval_id"],
                defaults={
                    "invoice_id": row["invoice_id"],
                    "step_no": _int(row["step_no"]),
                    "approver": self.fk(self.users, row.get("approver_user_id")),
                    "approver_role": approver_role_map.get(
                        row.get("approver_role"), _string(row.get("approver_role"))
                    ),
                    "action": _string(row.get("action")),
                    "acted_at": _datetime(row.get("acted_at")),
                    "comment": _string(row.get("comment")),
                },
            )

        return self.load("approvals", fn)

    def load_payments(self):
        def fn(row):
            Payment.objects.update_or_create(
                payment_id=row["payment_id"],
                defaults={
                    "invoice_id": row["invoice_id"],
                    "vendor": self.fk(self.vendors, row.get("vendor_id")),
                    "method": _string(row.get("method")),
                    "scheduled_date": _date(row.get("scheduled_date")),
                    "paid_date": _date(row.get("paid_date")),
                    "currency": _string(row.get("currency")),
                    "amount": _decimal(row.get("amount")),
                    "fx_rate_to_cad": _decimal(row.get("fx_rate_to_cad")),
                    "amount_cad": _decimal(row.get("amount_cad")),
                    "discount_taken": _decimal(row.get("discount_taken")),
                    "reference": _string(row.get("reference")),
                    "status": _string(row.get("status"), "PREPARED"),
                    "prepared_by": self.fk(self.users, row.get("prepared_by")),
                    "released_by": self.fk(self.users, row.get("released_by")),
                },
            )

        return self.load("payments", fn)

    def load_bank_changes(self):
        def fn(row):
            BankChange.objects.update_or_create(
                change_id=row["change_id"],
                defaults={
                    "vendor": self.fk(self.vendors, row.get("vendor_id")),
                    "changed_at": _date(row.get("changed_at")),
                    "changed_by": self.fk(self.users, row.get("changed_by_user_id")),
                    "request_channel": _string(row.get("request_channel")),
                    "verified_by_callback": _string(row.get("verified_by_callback")),
                    "old_account_last4": _string(row.get("old_account_last4")),
                    "new_account_last4": _string(row.get("new_account_last4")),
                },
            )

        return self.load("bank_change_history", fn)

    def load_approval_policies(self):
        def fn(row):
            ApprovalPolicy.objects.update_or_create(
                rule_id=row["rule_id"],
                defaults={
                    "rule_type": _string(row.get("rule_type")),
                    "condition": _string(row.get("condition")),
                    "required": _string(row.get("required")),
                    "notes": _string(row.get("notes")),
                },
            )

        return self.load("approval_policies", fn)

    def load_bank_statement(self):
        def fn(row):
            BankStatement.objects.update_or_create(
                bank_txn_id=row["bank_txn_id"],
                defaults={
                    "posted_date": _date(row.get("posted_date")),
                    "description": _string(row.get("description")),
                    "debit": _decimal(row.get("debit")),
                    "credit": _decimal(row.get("credit")),
                },
            )

        return self.load("bank_statement", fn)

    def load_card_transactions(self):
        def fn(row):
            CardTransaction.objects.update_or_create(
                txn_id=row["txn_id"],
                defaults={
                    "card_id": _string(row.get("card_id")),
                    "cardholder": self.fk(self.users, row.get("cardholder_user_id")),
                    "posted_date": _date(row.get("posted_date")),
                    "merchant_descriptor": _string(row.get("merchant_descriptor")),
                    "mcc": _string(row.get("mcc")),
                    "amount": _decimal(row.get("amount")),
                    "currency": _string(row.get("currency")),
                    "amount_cad": _decimal(row.get("amount_cad")),
                    "source": _string(row.get("source")),
                    "receipt_attached": _string(row.get("receipt_attached")),
                    "memo": _string(row.get("memo")),
                },
            )

        return self.load("card_transactions", fn)

    # -- orchestration ------------------------------------------------------

    def run(self) -> dict[str, int]:
        # One transaction for the whole load: thousands of per-row autocommits
        # are the dominant cost on SQLite (AGENTS.md §8).
        with transaction.atomic():
            counts: dict[str, int] = {}
            counts["departments"] = self.load_departments()
            counts["users"] = self.load_users()
            self.link_users()
            self.link_departments()
            counts["vendors"] = self.load_vendors()
            counts["gl_accounts"] = self.load_gl_accounts()
            counts["tax_codes"] = self.load_tax_codes()
            counts["fx_rates"] = self.load_fx_rates()
            counts["contracts"] = self.load_contracts()
            counts["purchase_orders"] = self.load_purchase_orders()
            counts["invoices"] = self.load_invoices()
            counts["invoice_lines"] = self.load_invoice_lines()
            counts["approvals"] = self.load_approvals()
            counts["payments"] = self.load_payments()
            counts["bank_change_history"] = self.load_bank_changes()
            counts["approval_policies"] = self.load_approval_policies()
            counts["bank_statement"] = self.load_bank_statement()
            counts["card_transactions"] = self.load_card_transactions()
            counts["emails"] = load_emails(self.data_dir, self.errors)
            return counts
