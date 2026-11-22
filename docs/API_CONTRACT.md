# Brim AP Automation — API Contract v2

Interface between the React/TypeScript frontend and the Django REST Framework
backend. Product requirements live in `docs/brief.md`; conventions live in
`AGENTS.md`. This document is the negotiated shape of the API — change it in the
same PR as the code and tell the frontend and backend owners.

## 0. What changed from v1

- Analysis now uses the canonical envelope: `validation_status` (not `status`)
  and always includes `extraction`.
- Added the **error envelope** and a **pagination envelope**.
- Added auth, AP-inbox, vendor mutations and bank changes, approval-policy
  administration, delegation, global audit + export, and `resolve-finding`.
- Duplicate findings split into `EXACT_DUPLICATE` (`BLOCK`) and
  `POSSIBLE_DUPLICATE` (`WARNING`).
- Single-resource responses stay **bare objects** (no `{ "data": ... }`
  wrapper).

### 0.1 Frontend-alignment decisions

Agreed with the frontend before implementation:

1. **Auth (1A).** Seeded users authenticate with a shared, fake demo password
   via `POST /api/auth/login/`; credentials are documented in §2.1. Tokens are
   DRF tokens sent as `Bearer`.
2. **Intake (2A).** Upload/inbox ingestion always creates a reviewable draft.
   Extraction failure or an unknown vendor yields a `DRAFT` invoice with
   `validation_status: "BLOCKED"` and a finding — never an error and never
   fabricated fields.
3. **Routing (3A).** `submit` validates and routes **atomically**: it creates the
   approval chain and moves the invoice to `PENDING_APPROVAL`. There is no
   separate routing endpoint; the chain (with reasons) is returned on the
   `Invoice` as `approvals`.
4. **Payments (4A).** `release` is the explicit human release **and** the
   simulated execution: it sets Payment `PAID` and Invoice `PAID` atomically.
   `RELEASED` is not a resting state in this flow.
5. **Findings (5B).** Each finding carries a stable `finding_id` and a
   `resolution` object; `validation_status` is computed from open findings only.
   `BLOCK` findings are never resolvable.

## 1. Conventions

These rules exist so the frontend can generate mocks mechanically and parse
every response with one set of helpers.

| Rule | Value |
|---|---|
| Base path | `/api/` |
| Auth | `Authorization: Bearer <token>` on every endpoint except login |
| JSON casing | `snake_case` |
| IDs | Opaque strings (`"AP-00001"`, `"V001"`, `"usr_..."`), never JSON integers |
| Timestamps | ISO-8601 UTC, always ending in `Z` (`"2026-09-02T14:05:00Z"`) |
| Dates | ISO-8601 date (`"2026-09-01"`) |
| Money, tax, rates | **Strings** (`"1234.56"`), never JSON numbers or floats |
| Enums | `UPPER_SNAKE` for roles/workflow; lowercase dataset codes for user/vendor status |
| Nulls | Missing values are `null`; keys are never omitted |
| Single resource | Returns the object directly |
| List resource | Returns the pagination envelope |
| Mutation | Returns the updated resource (same shape as its `GET`) |
| Delete | `204 No Content`, empty body |
| Errors | Always the error envelope (below) |

### 1.1 Pagination envelope

Every list endpoint returns:

```json
{
  "count": 137,
  "next": "/api/invoices/?page=2",
  "previous": null,
  "results": []
}
```

Query parameters: `page`, `page_size` (default 25, max 100), plus any
endpoint-specific filters listed below. `next` / `previous` are relative URLs or
`null`.

### 1.2 Error envelope

Every 4xx/5xx response returns:

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "AP Clerks cannot approve invoices.",
    "details": {}
  }
}
```

Stable `code` values (no prose, no stack traces):

| Code | HTTP | Meaning |
|---|---:|---|
| `UNAUTHENTICATED` | 401 | Missing/expired token |
| `PERMISSION_DENIED` | 403 | Role or object policy refusal (incl. separation of duties) |
| `NOT_FOUND` | 404 | Entity does not exist or is not visible to the caller |
| `INVALID_STATE_TRANSITION` | 409 | Action not legal from the current state |
| `SELF_APPROVAL_BLOCKED` | 409 | Requester tried to approve their own invoice |
| `LIMIT_EXCEEDED` | 409 | Amount/limit exceeds the actor's authority |
| `VALIDATION_BLOCKED` | 422 | Unresolved `BLOCK` finding prevents the action |
| `VALIDATION_ERROR` | 400 | Malformed request body / query |
| `INTERNAL_ERROR` | 500 | Unexpected failure; no internal detail is leaked |

`details` is free-form structured context (`{"field": "total"}`,
`{"from": "APPROVED", "to": "REVIEW"}`, etc.).

### 1.3 Enums

```
Role              EMPLOYEE | AP_CLERK | APPROVER | FINANCE_MANAGER | CONTROLLER | AUDITOR
UserStatus        active | on_leave | terminated
InvoiceStatus     DRAFT | REVIEW | PENDING_APPROVAL | APPROVED | PAID
                  (historical rows may also serialize as SCHEDULED | REJECTED)
ValidationStatus  PASSED | WARNING | BLOCKED
Severity          BLOCK | WARNING
ApprovalStatus    PENDING | APPROVED | REJECTED
PaymentStatus     PREPARED | SCHEDULED | RELEASED | PAID | FAILED | CANCELLED
VendorStatus      active | on_hold | pending_review
BankChangeStatus  pending | approved | rejected
EmailClass        INVOICE | NOT_INVOICE | UNCERTAIN
```

### 1.4 Shared object shapes

**Money and decimals.** DRF serializes `DecimalField` as a string; keep that
on. Never coerce money to a JS `number`.

**A `null` means "not captured", not zero.** Validation reports missing values
explicitly (see finding codes) rather than treating them as pass.

## 2. Auth & users

```
POST   /api/auth/login/          { username, password } -> { token, user }
POST   /api/auth/logout/         -> 204
GET    /api/auth/me/             -> User
GET    /api/users/               -> paginated User      (CONTROLLER, AUDITOR)
GET    /api/users/{id}/          -> User                (CONTROLLER, AUDITOR)
PATCH  /api/users/{id}/          -> User                (CONTROLLER)
```

- Roles: every authenticated role may call `me`; user administration is
  `CONTROLLER` only; `AUDITOR` may read.
- The server sets the actor from the token. The client never sends `actor_id`,
  `role`, or `approved_by`.
- Demo role switching, if provided, must log in as a real seeded user and
  return a real token.

### 2.1 Demo credentials (1A)

Login is `POST /api/auth/login/` with `username` = the dataset `user_id` and one
shared, fake password for every seeded user: `demo1234`.

| Role | Username | Name |
|---|---|---|
| Employee | `U013` | Aiden Grant |
| AP Clerk | `U004` | Jordan Okafor |
| Approver | `U007` | Dev Malhotra |
| Finance Manager | `U003` | Elise Tremblay |
| Controller / Admin | `U001` | Priya Raman |
| Auditor | `U006` | Hannah Lindqvist |

Response: `{ "token": "<opaque DRF token>", "user": { … } }`; send
`Authorization: Bearer <token>` afterwards. These are synthetic accounts — never
use this password outside the demo. The seed command must set it for each seeded
user (the current loader sets an unusable password, so this is a backend task).
There is no signup endpoint. The same table is kept in `docs/DEMO_USERS.md`.

**User**

```json
{
  "id": "U007",
  "username": "U007",
  "full_name": "Dev Malhotra",
  "email": "dev.malhotra@harborline-logistics.example",
  "role": "APPROVER",
  "title": "Operations Manager",
  "department": { "id": "D01", "name": "Operations" },
  "manager_id": "U001",
  "delegate_id": null,
  "approval_limit_cad": "10000.00",
  "work_province": "ON",
  "status": "active"
}
```

## 3. Invoice intake & AP inbox (feature 1)

```
GET    /api/inbox/                     -> paginated Email
POST   /api/inbox/sync/                -> { ingested, skipped, routed }
GET    /api/inbox/{id}/                -> Email
POST   /api/inbox/{id}/ingest/         -> Invoice      (attachment -> DRAFT bill)
POST   /api/inbox/{id}/dismiss/        -> 204
```

- `sync` reads the AP inbox (dataset `inbox/emails.json` in dev), classifies
  each email, and creates draft bills for attachment-bearing invoices.
- Emails that are not invoices, or have no attachment, are classified and NOT
  turned into bills; they appear in `routed` for review.
- Upload path: `POST /api/invoices/upload/` (multipart `file`) does the same
  for a direct upload.

### 3.1 Extraction failure & unknown vendors (2A)

Intake never fails silently and never fabricates data. A stored upload or inbox
attachment always produces a reviewable `DRAFT` invoice:

| Situation | Result |
|---|---|
| Extraction succeeds | `DRAFT` with populated `extraction`; `validation_status` from the checks |
| Extraction fails / times out / malformed model output | `DRAFT`, `extraction` fields `null`, `validation_status: "BLOCKED"`, finding `EXTRACTION_FAILED` |
| File unreadable or corrupt | `DRAFT`, `validation_status: "BLOCKED"`, finding `EXTRACTION_UNREADABLE`; the original file is kept |
| Unknown vendor | `vendor: null`, `validation_status: "BLOCKED"`, finding `VENDOR_UNKNOWN`; the clerk assigns a vendor and re-runs `/analyze/` |
| File cannot be stored at all | `400 VALIDATION_ERROR`; no invoice is created |

`POST /api/invoices/upload/` and `POST /api/inbox/{id}/ingest/` return `201`
with the created `Invoice`. Extraction only ever returns `null` for missing
values; it never guesses a field.

**Email**

```json
{
  "id": "EM-0001",
  "sender": "billing@acme.example",
  "from_name": "Acme Billing",
  "subject": "Invoice 1042",
  "received_at": "2026-09-02T14:05:00Z",
  "body_excerpt": "Please find attached...",
  "attachment": { "filename": "inv.pdf", "content_type": "application/pdf" },
  "classification": "INVOICE",
  "classification_confidence": "0.94",
  "invoice_id": "AP-00051",
  "status": "INGESTED"
}
```

## 4. Invoices — extraction, coding, validation (features 2–5)

```
GET    /api/invoices/                      -> paginated Invoice
POST   /api/invoices/upload/               multipart -> Invoice   (creates DRAFT, runs extraction)
GET    /api/invoices/{id}/                 -> Invoice
PATCH  /api/invoices/{id}/                 -> Invoice             (corrections in DRAFT/REVIEW, audited)
POST   /api/invoices/{id}/analyze/         -> AnalysisResponse    (runs extraction + checks)
POST   /api/invoices/{id}/submit/          -> Invoice             (DRAFT/REVIEW -> PENDING_APPROVAL)
POST   /api/invoices/{id}/resolve-finding/ { finding_id, justification } -> Invoice
```

Filters for the list: `status`, `vendor_id`, `department_id`, `requester_id`,
`validation_status`, `q` (free text over vendor name / invoice number).

### 4.1 Invoice

```json
{
  "id": "AP-00051",
  "status": "REVIEW",
  "vendor": { "id": "V015", "legal_name": "Polar Freight Lines Ltd.", "status": "active" },
  "invoice_number": "INV-1042",
  "invoice_date": "2026-09-01",
  "received_date": "2026-09-02",
  "due_date": "2026-10-01",
  "currency": "USD",
  "subtotal": "1000.00",
  "tax_lines": [{ "tax_code": "GST", "rate": "0.05", "amount": "50.00" }],
  "total": "1050.00",
  "fx_rate_to_cad": "1.3800",
  "fx_rate_date": "2026-09-01",
  "total_cad": "1449.00",
  "ship_to_province": "ON",
  "department": { "id": "D01", "name": "Operations" },
  "requester_id": "U012",
  "po_id": "PO-2026-0001",
  "contract_id": null,
  "lines": [
    {
      "line_no": 1,
      "description": "Freight YYZ-YVR",
      "quantity": "1.00",
      "unit_price": "1000.00",
      "amount": "1000.00",
      "gl_account": "5100",
      "department_id": "D01",
      "gst_hst_code": "GST",
      "pst_qst_code": "",
      "line_type": "expense"
    }
  ],
  "validation_status": "WARNING",
  "findings": [
    {
      "finding_id": "F-POSSIBLE_DUPLICATE-4b7a",
      "code": "POSSIBLE_DUPLICATE",
      "severity": "WARNING",
      "message": "A similar invoice from this vendor with the same amount exists within the date window.",
      "evidence": { "matching_invoice_id": "AP-00007", "match_type": "NEAR" },
      "resolution": null
    }
  ],
  "coding_suggestions": [
    {
      "line_no": 1,
      "suggested_gl_account": "5100",
      "suggested_department_id": "D01",
      "confidence": "0.87",
      "reason": "Matches 14 historical Polar Freight freight invoices"
    }
  ],
  "approvals": [],
  "created_at": "2026-09-02T14:05:00Z",
  "updated_at": "2026-09-02T14:06:00Z"
}
```

- `invoice_number` is the vendor's number (stored as `vendor_invoice_number`).
- `tax_lines` map each tax amount to a supplied tax code; `rate` is a string
  decimal (`"0.13"`). Place of supply is `ship_to_province`.
- `lines` carry the accepted coding; `coding_suggestions` carry per-line
  suggestions with a reason. Accepting or changing a suggestion is a `PATCH` and
  is audited.

### 4.2 AnalysisResponse (canonical envelope)

Returned by `/analyze/`, and persisted on the invoice in
`validation_status`, `findings`, `coding_suggestions`, `raw_extraction`.

```json
{
  "validation_status": "WARNING",
  "findings": [
    {
      "finding_id": "F-POSSIBLE_DUPLICATE-4b7a",
      "code": "POSSIBLE_DUPLICATE",
      "severity": "WARNING",
      "message": "A similar invoice from this vendor with the same amount exists within the date window.",
      "evidence": {
        "matching_invoice_id": "AP-00007",
        "match_type": "NEAR",
        "matching_invoice_date": "2026-08-29",
        "days_apart": 3
      },
      "resolution": null
    }
  ],
  "coding_suggestions": [
    {
      "line_no": 1,
      "suggested_gl_account": "5100",
      "suggested_department_id": "D01",
      "confidence": "0.87",
      "reason": "Matches historical freight invoices"
    }
  ],
  "extraction": {
    "vendor_name": "Polar Freight Lines Ltd.",
    "invoice_number": "INV-1042",
    "invoice_date": "2026-09-01",
    "due_date": "2026-10-01",
    "currency": "USD",
    "subtotal": "1000.00",
    "tax_lines": [{ "tax_code": "GST", "amount": "50.00" }],
    "total": "1050.00",
    "line_items": [
      { "description": "Freight YYZ-YVR", "quantity": "1", "unit_price": "1000.00", "amount": "1000.00" }
    ]
  }
}
```

`validation_status` is `PASSED` when the checks that ran found nothing. It is
not proof that skipped checks passed: missing reference data is reported as a
finding, never as silence.

### 4.3 Validation finding

```json
{
  "finding_id": "F-PO_AMOUNT_EXCEEDED-9c1e",
  "code": "PO_AMOUNT_EXCEEDED",
  "severity": "BLOCK",
  "message": "Invoice total exceeds purchase order amount.",
  "evidence": { "invoice_total": "150.00", "po_total": "100.00" },
  "resolution": null
}
```

A resolved warning keeps its place in `findings` with an annotation:

```json
{
  "finding_id": "F-POSSIBLE_DUPLICATE-4b7a",
  "code": "POSSIBLE_DUPLICATE",
  "severity": "WARNING",
  "message": "A similar invoice from this vendor with the same amount exists within the date window.",
  "evidence": { "matching_invoice_id": "AP-00007" },
  "resolution": {
    "status": "RESOLVED",
    "resolved_by_id": "U004",
    "resolved_at": "2026-09-03T10:00:00Z",
    "justification": "Confirmed with vendor; different job."
  }
}
```

- `finding_id` is deterministic (derived from `code` + `evidence`) and stable
  across responses, so the frontend can target a specific finding.
- `resolution` is `null` while open; once resolved it is
  `{ "status": "RESOLVED", "resolved_by_id", "resolved_at", "justification" }`.
- `validation_status` is computed from **open** findings only, so resolving a
  `WARNING` can move an invoice from `WARNING` to `PASSED`.
- `BLOCK` stops submission and release until the underlying issue is fixed and
  can never be resolved or overridden.
- `WARNING` needs review and a documented override via `resolve-finding`.
- `code` is stable and deterministic; model prose goes in `message`, never
  `code`.
- Re-analysis recomputes findings. A resolution is retained only if the same
  `finding_id` still exists; otherwise it is dropped so a stale override cannot
  hide a new issue.

Finding codes:

```
MISSING_FIELD               INVALID_AMOUNT             TOTAL_MISMATCH
EXTRACTION_FAILED           EXTRACTION_UNREADABLE      VENDOR_UNKNOWN
VENDOR_ON_HOLD              TAX_RATE_MISMATCH          TAX_PROVINCE_MISMATCH
EXACT_DUPLICATE             POSSIBLE_DUPLICATE         CARD_INVOICE
PO_NOT_FOUND                PO_VENDOR_MISMATCH         PO_CURRENCY_MISMATCH
PO_AMOUNT_EXCEEDED          CONTRACT_NOT_FOUND         CONTRACT_VENDOR_MISMATCH
CONTRACT_CURRENCY_MISMATCH  CONTRACT_INACTIVE          CONTRACT_DATE_OUTSIDE_TERM
CONTRACT_FEE_EXCEEDED       UNVERIFIED_BANK_CHANGE
```

Duplicate severities: `EXACT_DUPLICATE` (same vendor + same number once
formatting is normalized, including reformatted numbers) is `BLOCK`;
`POSSIBLE_DUPLICATE` (near amount/date, or already paid by card) is `WARNING`.

### 4.4 Resolving a finding

`POST /api/invoices/{id}/resolve-finding/`

Request:

```json
{ "finding_id": "F-POSSIBLE_DUPLICATE-4b7a", "justification": "Confirmed with vendor; different job." }
```

- The target is the stable `finding_id`, so one of several findings with the
  same `code` can be resolved individually.
- Only `WARNING` findings can be resolved. A `BLOCK` returns
  `VALIDATION_BLOCKED` and can never be overridden by any role; the underlying
  data must be corrected.
- Resolution sets that finding's `resolution` object, recomputes
  `validation_status` from the open findings, and writes an audit event with the
  justification and actor.
- Allowed for `AP_CLERK` (and `FINANCE_MANAGER`, `CONTROLLER`). The response is
  the updated `Invoice`.

## 5. Vendors & bank changes (feature 9)

```
GET    /api/vendors/                    -> paginated Vendor   (filters: status, category, q)
POST   /api/vendors/                    -> Vendor            (onboard; status pending_review)
GET    /api/vendors/{id}/               -> Vendor
PATCH  /api/vendors/{id}/               -> Vendor
POST   /api/vendors/{id}/approve/       -> Vendor            (pending_review -> active; FINANCE_MANAGER)
POST   /api/vendors/{id}/hold/          -> Vendor            (-> on_hold)
POST   /api/vendors/{id}/unhold/        -> Vendor            (on_hold -> active; FINANCE_MANAGER)
GET    /api/vendors/{id}/bank-changes/  -> paginated BankChange
POST   /api/vendors/{id}/bank-changes/  { bank_account, note } -> BankChange (controlled action)
POST   /api/vendors/{id}/bank-changes/{change_id}/approve/ -> BankChange
POST   /api/vendors/{id}/bank-changes/{change_id}/reject/  -> BankChange
```

- Onboarding creates `pending_review`; invoices for non-`active` vendors raise
  `VENDOR_UNKNOWN` / `VENDOR_ON_HOLD`.
- Bank details are never directly `PATCH`-able. A change creates a `pending`
  `BankChange`; invoices from a vendor with a recent unverified change get
  `UNVERIFIED_BANK_CHANGE`.
- Bank account numbers are masked in every response and log.

**Vendor**

```json
{
  "id": "V015",
  "legal_name": "Polar Freight Lines Ltd.",
  "category": "Freight",
  "default_gl_account": "5100",
  "address": "100 Main St, Toronto, ON",
  "province_or_state": "ON",
  "country": "CA",
  "gst_hst_number": "123456789RT0001",
  "qst_number": "",
  "payment_terms_days": 30,
  "early_pay_discount": "",
  "preferred_payment_method": "EFT",
  "accepts_card_payment": "no",
  "bank_institution": "***",
  "bank_account_masked": "**** 4821",
  "bank_details_updated_at": "2026-01-14",
  "ap_contact_email": "billing@polar.example",
  "requires_po": "yes",
  "status": "active",
  "onboarded_at": "2025-11-01",
  "pending_bank_change": null
}
```

**BankChange**

```json
{
  "id": "BC-001",
  "vendor_id": "V015",
  "status": "pending",
  "changed_at": "2026-01-14",
  "requested_by_id": "U020",
  "request_channel": "email_request",
  "verified_by_callback": "no",
  "old_account_last4": "4821",
  "new_account_last4": "9933",
  "decided_by_id": null,
  "decided_at": null
}
```

## 6. Approvals, policies & delegation (feature 6)

```
GET    /api/approvals/                  -> paginated Approval (filters: invoice_id, status, mine)
GET    /api/approvals/{id}/             -> Approval
POST   /api/approvals/{id}/approve/     { comment } -> Invoice   (updated approval chain)
POST   /api/approvals/{id}/reject/      { comment } -> Invoice   (returns invoice to REVIEW)
```

- Routing is policy-driven by amount (CAD), department, vendor status and legal
  invoices. Approvals are sequential.
- Rules that always apply regardless of policy: no self-approval (escalate to
  the requester's manager); absent/delegated approvers are handled by
  delegation; inactive/terminated users cannot act; an approver cannot release
  the payment for an invoice they approved.
- A rejected invoice returns to `REVIEW`; the approval chain is retained.

### 6.1 Submit routes atomically (3A)

There is no separate routing endpoint. `POST /api/invoices/{id}/submit/` does,
in one transaction:

1. Reject if any `BLOCK` finding is open (`422 VALIDATION_BLOCKED`).
2. Evaluate the active approval policies (amount in CAD, department, vendor
   status, legal/new-vendor flags).
3. Create the ordered PENDING `Approval` steps.
4. Move the invoice `DRAFT` or `REVIEW` → `PENDING_APPROVAL`.
5. Write the audit event.

The response is the updated `Invoice`, whose `approvals` array is the routing
preview: each step carries a human-readable `reason` (for example "Department
manager; within limit"). This keeps mutations as bare resources and still
explains the routing.

**Approval**

```json
{
  "id": "APR-00091",
  "invoice_id": "AP-00051",
  "step_no": 1,
  "status": "PENDING",
  "approver": { "id": "U007", "full_name": "Dev Malhotra", "role": "APPROVER" },
  "delegated_for_id": null,
  "comment": null,
  "reason": "Department manager; within limit",
  "acted_at": null
}
```

### 6.2 Approval policies (admin-editable, audited)

```
GET    /api/policies/          -> paginated Policy   (CONTROLLER, AUDITOR)
POST   /api/policies/          -> Policy             (CONTROLLER)
GET    /api/policies/{id}/     -> Policy
PATCH  /api/policies/{id}/     -> Policy             (CONTROLLER)
DELETE /api/policies/{id}/     -> 204                (CONTROLLER; soft-archive, audited)
```

```json
{
  "id": "POL-01",
  "name": "Operations over 25k",
  "priority": 10,
  "active": true,
  "conditions": {
    "min_amount_cad": "25000.00",
    "max_amount_cad": null,
    "department_id": "D01",
    "vendor_status": "active",
    "legal_invoice": false,
    "new_vendor": false
  },
  "steps": [
    { "step_no": 1, "role": "APPROVER", "approver_id": null },
    { "step_no": 2, "role": "FINANCE_MANAGER", "approver_id": null }
  ]
}
```

Every policy create/update/delete writes an audit event with before/after.

### 6.3 Delegation

```
GET    /api/delegations/        -> paginated Delegation
POST   /api/delegations/        -> Delegation
DELETE /api/delegations/{id}/   -> 204
```

```json
{
  "id": "DEL-01",
  "principal_id": "U007",
  "delegate_id": "U009",
  "starts_at": "2026-09-01T00:00:00Z",
  "ends_at": "2026-09-15T00:00:00Z",
  "active": true
}
```

Actions taken by a delegate return `delegated_for_id` on the approval and set
`on_behalf_of_id` on the audit event.

## 7. Payments (feature 7)

```
GET    /api/payments/               -> paginated Payment (filters: status, invoice_id)
POST   /api/payments/prepare/       { invoice_id } -> Payment   (invoice must be APPROVED)
GET    /api/payments/{id}/          -> Payment
POST   /api/payments/{id}/release/  -> Payment   (idempotent)
POST   /api/payments/{id}/cancel/   -> Payment
```

- Release requires an explicit authorized human; an AI suggestion is never a
  release.
- Release limits are in CAD: `FINANCE_MANAGER` up to `100000.00`; `CONTROLLER`
  any amount. Over-limit returns `LIMIT_EXCEEDED`.
- The approver of the invoice cannot release its payment
  (`PERMISSION_DENIED`).
- `release` is idempotent: repeating it returns the same payment and never
  creates a second one.
- Payment execution is simulated; `RELEASED` and `PAID` are recorded, no real
  funds move.
- **Release executes immediately (4A).** `POST /api/payments/{id}/release/`
  performs the explicit human release and the simulated execution in one
  transaction: it enforces the role limit and separation of duties, then sets
  Payment `PAID` and Invoice `PAID`, recording `released_by_id` (the release
  timestamp is on the audit event). `RELEASED` is reserved for a future
  asynchronous path and is not a resting state in this flow. The call is
  idempotent — a retry returns the same `PAID` payment and never creates a
  second one.

**Payment**

```json
{
  "id": "PAY-00001",
  "invoice_id": "AP-00051",
  "status": "SCHEDULED",
  "method": "EFT",
  "currency": "USD",
  "amount": "1050.00",
  "fx_rate_to_cad": "1.3800",
  "amount_cad": "1449.00",
  "discount_taken": null,
  "reference": "",
  "scheduled_date": "2026-09-10",
  "paid_date": null,
  "bank_account_masked": "**** 4821",
  "prepared_by_id": "U003",
  "released_by_id": null,
  "failure_reason": null,
  "created_at": "2026-09-03T09:00:00Z"
}
```

## 8. Audit trail & dashboard (feature 8)

```
GET    /api/audit/                  -> paginated AuditEvent   (AUDITOR, CONTROLLER; role-scoped)
GET    /api/audit/export/           -> CSV file               (AUDITOR, CONTROLLER)
GET    /api/invoices/{id}/audit/    -> InvoiceTrace
GET    /api/dashboard/              -> DashboardSummary
```

List filters: `entity_type`, `entity_id`, `actor_id`, `action`, `from`, `to`.

**AuditEvent**

```json
{
  "id": "AUD-00001",
  "actor_id": "U007",
  "actor_name": "Dev Malhotra",
  "on_behalf_of_id": null,
  "action": "INVOICE_APPROVED",
  "entity_type": "INVOICE",
  "entity_id": "AP-00051",
  "before": { "status": "PENDING_APPROVAL" },
  "after": { "status": "APPROVED" },
  "evidence": {},
  "timestamp": "2026-09-03T09:12:00Z"
}
```

- The audit log is append-only: there are no update or delete endpoints.
- Every material action writes an event in the same transaction as the change.

**InvoiceTrace** (`GET /api/invoices/{id}/audit/`) links an invoice to its
approval chain, payment and accounting codes for the audit-ready view:

```json
{
  "invoice_id": "AP-00051",
  "invoice": {},
  "approvals": [],
  "payments": [],
  "coding_history": [],
  "events": []
}
```

**DashboardSummary** (role-aware: each role sees its own queue)

```json
{
  "role": "APPROVER",
  "counts": {
    "pending_my_approval": 4,
    "in_review": 2,
    "payments_due": 1,
    "open_findings": 3
  },
  "pending_approvals": [],
  "payments_due": [],
  "recent_activity": []
}
```

## 9. Workflow & invariants

Invoice transitions:

- intake (upload / inbox ingest) → `DRAFT`
- `DRAFT` or `REVIEW` ─submit (validate + route atomically)→ `PENDING_APPROVAL`
- `PENDING_APPROVAL` ─reject→ `REVIEW`
- `PENDING_APPROVAL` ─all steps approved→ `APPROVED`
- `APPROVED` ─prepare→ Payment `PREPARED` (invoice stays `APPROVED`)
- Payment `release` → Payment `PAID` and Invoice `PAID` atomically

```
DRAFT ─submit(validate+route)→ PENDING_APPROVAL ─all approved→ APPROVED ─release→ PAID
  ▲                                   │
  └────────reject → REVIEW ─submit────┘
```

Payment: `PREPARED → PAID` on release (optionally `SCHEDULED` before release),
plus `FAILED` and `CANCELLED`. `RELEASED` is not a resting state.

- Invoice `PAID` is set only by a successful simulated payment, never by an
  approval action.
- Invalid transitions return `INVALID_STATE_TRANSITION` and change nothing.
- Automation never approves or pays.
- Authorization is enforced server-side for every read and mutation; the
  frontend hiding a control is never the enforcement.

## 10. Feature coverage

| # | Feature | Endpoints |
|---|---|---|
| 1 | Invoice intake | `/inbox/`, `/inbox/sync/`, `/inbox/{id}/ingest/`, `/invoices/upload/` |
| 2 | Data extraction | `/invoices/upload/`, `/invoices/{id}/analyze/` (`extraction`) |
| 3 | Smart coding | `/invoices/{id}/analyze/` (`coding_suggestions`, per line), `PATCH /invoices/{id}/` |
| 4 | Validation & matching | `/invoices/{id}/analyze/` (`findings`, `validation_status`), `/invoices/{id}/resolve-finding/` |
| 5 | Duplicate detection | `/invoices/{id}/analyze/` (`EXACT_DUPLICATE` / `POSSIBLE_DUPLICATE`) |
| 6 | Approval workflow | `/approvals/…`, `/policies/…`, `/delegations/…` |
| 7 | Payments | `/payments/…` |
| 8 | Audit trail | `/audit/`, `/audit/export/`, `/invoices/{id}/audit/` |
| 9 | Vendor management | `/vendors/…`, `/vendors/{id}/bank-changes/…` |

## 11. Frontend mocking guide

1. **Two success shapes only** — bare object or pagination envelope. Generate
   one MSW handler per row in this document.
2. **Money is a string** — fixtures copy the examples verbatim; never pass money
   through `Number()`.
3. **Mutations echo the resource** — a mocked `POST …/approve/` returns a full
   `Invoice`, matching the `GET`, so React state uses one type.
4. **One error parser** — switch on `error.code`; mocks can throw
   `ErrorEnvelope` for any 4xx.
5. **Opaque string IDs** — fixtures use a stable set (`V015`, `AP-00051`,
   `U007`); route params are strings end to end.
6. **Filters are query params** — a mock may ignore filters and still
   type-check.
7. **Findings are annotated, not removed** — resolved warnings stay in
   `findings` with a non-null `resolution`; compute "needs attention" as
   `findings.filter((f) => f.resolution === null)`.
8. **Submit returns the Invoice** — read `approvals[]` for the new chain and each
   step's `reason`; there is no separate routing call.

## 12. Storage mapping notes (implementation detail, not API)

- `invoice_number` (API) ↔ `Invoice.vendor_invoice_number`.
- `id` (API) ↔ each model's natural string primary key
  (`invoice_id`, `vendor_id`, `payment_id`, `department_id`, …); `User.id`
  is `user_id` (`U007`).
- `extraction` (API) ↔ `Invoice.raw_extraction`.
- Historical dataset statuses are normalized on serialization to the canonical
  enums above; new records use the canonical values.
- `bank_account` is stored for matching but only `bank_account_masked` is ever
  serialized.
