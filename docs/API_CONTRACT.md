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
- Added reference-data endpoints, the `PATCH /invoices/{id}/` body, a role ×
  capability matrix, and concrete dashboard / invoice-trace item types.
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
BankChangeStatus  PENDING | APPROVED | REJECTED (null for historical rows)
EmailClass        INVOICE | NOT_INVOICE | UNCERTAIN
EmailStatus       NEW | INGESTED | PARTIAL | ROUTED | DISMISSED
EmailAttachmentStatus NEW | INGESTED | FAILED
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
use this password outside the demo. The seed sets it for each user from the
`DEMO_PASSWORD` environment variable (default `demo1234`; see
`backend/.env.example`). There is no signup endpoint. The same table is kept in
`docs/DEMO_USERS.md`.

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

### 2.2 Role × capability matrix

Legend: ✅ allowed · ❌ forbidden · ⚠️ conditional (see notes) · — not applicable.

| Capability | Employee | AP Clerk | Approver | Finance Mgr | Controller | Auditor |
|---|---|---|---|---|---|---|
| Submit / upload invoices | ✅ own dept | ✅ | ✅ own dept | ✅ | ✅ | ❌ |
| See invoices | own dept | all | own dept + assigned approval steps | all | all | all (read) |
| Correct coding / review extraction | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Resolve `WARNING` findings | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Approve / reject | ❌ | ❌ | ⚠️ own dept ≤ limit, or assigned step | ⚠️ above limit / flagged / new vendor | ⚠️ large amounts per policy | ❌ |
| Prepare payment | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Release payment | ❌ | ❌ | ❌ | ⚠️ ≤ CAD 100,000 | ✅ any | ❌ |
| Vendor onboard / approve / hold | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Approve vendor bank change | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Edit approval policies | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Manage users & roles | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| View / export audit | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

Universal rules override the table:

- No self-approval — the requester never approves their own invoice; it
  escalates to their manager.
- Separation of duties — anyone who approved an invoice cannot release its
  payment (applies to `APPROVER`, `FINANCE_MANAGER` and `CONTROLLER`).
- Delegated actions are recorded as delegated (`delegated_for_id` /
  `on_behalf_of_id`).
- Inactive / terminated users cannot act; on-leave users act only through an
  active delegate. Delegation is checked on every action.
- Lists are server-scoped: a role never receives rows it may not see. The UI
  hiding a control is never the enforcement.
- `CONTROLLER` may be an approval step for large amounts per policy (P03/P04);
  the separation-of-duties rules still apply.
- An approver assigned a step (including cross-department escalation) can see
  that invoice; an active delegate can see the step and its invoice while the
  principal is on leave. Unrelated cross-department invoices stay hidden.

## 3. Reference data (departments, GL accounts, tax codes)

```
GET    /api/departments/     -> paginated Department    (all authenticated roles)
GET    /api/gl-accounts/     -> paginated GLAccount     (filter: account_type)
GET    /api/tax-codes/       -> paginated TaxCode       (all authenticated roles)
```

Read-only pickers for the coding and review UI. They use the pagination
envelope like every list; request `?page_size=100` to fetch the full set in one
call.

**Department**

```json
{ "id": "D01", "name": "Operations", "cost_centre": "1100", "annual_budget_cad": "1800000.00", "manager_id": "U007" }
```

**GLAccount**

```json
{ "account_number": "5010", "name": "Freight & Carrier Costs", "account_type": "expense", "notes": "" }
```

- `account_number` is the canonical code used in `lines[].gl_account` and
  `coding_suggestions[].suggested_gl_account`; it is the resource identifier
  (there is no separate `id` for GL accounts).
- `account_type` ∈ `asset | liability | expense`; the coding picker fetches
  `?account_type=expense`.

**TaxCode**

```json
{ "code": "GST5", "description": "GST 5%", "rate": "0.05", "applies_to": "all", "recoverable": "yes", "gl_account": "1160" }
```

Canonical tax codes (used in `tax_lines[].tax_code` and
`lines[].gst_hst_code` / `pst_qst_code`):

```
GST5      GST 5%
HST13     Ontario HST 13%
PST7_BC   BC PST 7% (goods only)
QST9975   Quebec QST 9.975% (on the pre-tax amount)
EXEMPT    Exempt supply (e.g. insurance premiums)
FOREIGN   Foreign vendor, no Canadian tax charged
```

`rate` is a decimal string; `EXEMPT` and `FOREIGN` have `rate: "0"`.

## 4. Invoice intake & AP inbox (feature 1)

```
GET    /api/inbox/                     -> paginated Email
POST   /api/inbox/sync/                -> { ingested, skipped, routed }
GET    /api/inbox/{id}/                -> Email
POST   /api/inbox/{id}/ingest/         -> { email, invoices[] }  (one draft per attachment)
POST   /api/inbox/{id}/dismiss/        -> 204
```

- `sync` reads the AP inbox (dataset `inbox/emails.json` in dev), classifies
  each email, and creates **one draft per attachment** for attachment-bearing
  invoices.
- Emails that are not invoices, or have no attachment, are classified and NOT
  turned into bills; they are `ROUTED` for review.
- `ingest` turns the email's attachments into drafts on demand (all by default,
  or one via `{ "attachment": "<filename>" }`). It is idempotent per attachment.
- Upload path: `POST /api/invoices/upload/` (multipart `file`) does the same
  for a direct upload.

### 4.1 Extraction failure & unknown vendors (2A)

Intake never fails silently and never fabricates data. A stored upload or inbox
attachment always produces a reviewable `DRAFT` invoice:

| Situation | Result |
|---|---|
| Extraction succeeds | `DRAFT` with populated `extraction`; `validation_status` from the checks |
| Extraction fails / times out / malformed model output / corrupt content | `DRAFT`, `extraction` fields `null`, `validation_status: "BLOCKED"`, finding `EXTRACTION_FAILED` |
| File missing or unreadable | `DRAFT`, `validation_status: "BLOCKED"`, finding `EXTRACTION_UNREADABLE`; the original file is kept if present |
| Unknown vendor | `vendor: null`, `validation_status: "BLOCKED"`, finding `VENDOR_UNKNOWN`; the clerk assigns a vendor and re-runs `/analyze/` |
| File cannot be stored at all | `400 VALIDATION_ERROR`; no invoice is created |

`POST /api/invoices/upload/` returns `201` with the created `Invoice`.
`POST /api/inbox/{id}/ingest/` returns `200` with
`{ "email": Email, "invoices": Invoice[] }` (one draft per attachment).
Extraction only ever returns `null` for missing values; it never guesses a
field. It reads text PDFs directly, renders text-poor PDF pages and PNG/JPEG
attachments for a vision-capable model, and supports English and French
documents. The normalized extraction also carries `vendor_tax_number`,
`ship_to_province`, `po_number`, `contract_reference`, `language`,
`tax_lines` (`tax_code`, `label`, `rate`, `amount`) and per-line `tax_code`;
PO/contract resolution and province-tax validation are separate steps.
Document text is untrusted and is never executed as instructions.

Extraction failures use stable finding codes: `EXTRACTION_UNREADABLE` for a
missing/unsupported/corrupt/password-protected file, and `EXTRACTION_FAILED`
for provider, timeout, malformed-JSON or unusable-output errors. Both create a
reviewable `DRAFT` rather than an API error.

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
  "attachments": [
    {
      "filename": "inv.pdf",
      "content_type": "application/pdf",
      "order": 0,
      "status": "INGESTED",
      "invoice_id": "AP-00051",
      "error": ""
    }
  ],
  "classification": "INVOICE",
  "classification_confidence": "0.94",
  "invoice_id": "AP-00051",
  "invoice_ids": ["AP-00051"],
  "status": "INGESTED"
}
```

`attachment` / `invoice_id` are the primary (first) attachment/invoice for
backward compatibility; `attachments[]` / `invoice_ids[]` carry all of them.
One email can produce multiple invoices (for example two invoice PDFs).

## 5. Invoices — extraction, coding, validation (features 2–5)

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

### 5.1 Invoice

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
  "tax_lines": [{ "tax_code": "GST5", "rate": "0.05", "amount": "50.00" }],
  "total": "1050.00",
  "fx_rate_to_cad": "1.3800",
  "fx_rate_date": "2026-09-01",
  "total_cad": "1449.00",
  "ship_to_province": "AB",
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
      "gl_account": "5010",
      "department_id": "D01",
      "gst_hst_code": "GST5",
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
      "suggested_gl_account": "5010",
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
  suggestions with a reason. Each suggestion has `line_no`,
  `suggested_gl_account`, `suggested_department_id`, `confidence` and `reason`.
  Suggestions are learned from the vendor's historical lines first, with an AI
  fallback for unmatched lines; a line with no confident suggestion returns
  `suggested_gl_account: null` and a reason asking for manual review. Accepted
  or changed coding is a `PATCH` and is audited.

### 5.2 AnalysisResponse (canonical envelope)

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
      "suggested_gl_account": "5010",
      "suggested_department_id": "D01",
      "confidence": "0.87",
      "reason": "Matches historical freight invoices"
    }
  ],
  "extraction": {
    "vendor_name": "Polar Freight Lines Ltd.",
    "vendor_tax_number": "995133220RT0001",
    "invoice_number": "INV-1042",
    "invoice_date": "2026-09-01",
    "due_date": "2026-10-01",
    "currency": "USD",
    "subtotal": "1000.00",
    "tax_lines": [{ "tax_code": "GST5", "amount": "50.00" }],
    "total": "1050.00",
    "ship_to_province": "ON",
    "po_number": null,
    "contract_reference": null,
    "language": "en",
    "line_items": [
      { "description": "Freight YYZ-YVR", "quantity": "1", "unit_price": "1000.00", "amount": "1000.00" }
    ]
  }
}
```

`validation_status` is `PASSED` when the checks that ran found nothing. It is
not proof that skipped checks passed: missing reference data is reported as a
finding, never as silence.

### 5.3 Validation finding

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
PO_NOT_FOUND                PO_REQUIRED_MISSING        PO_VENDOR_MISMATCH
PO_CURRENCY_MISMATCH        PO_AMOUNT_EXCEEDED         PO_CUMULATIVE_EXCEEDED
CONTRACT_NOT_FOUND          CONTRACT_VENDOR_MISMATCH   CONTRACT_CURRENCY_MISMATCH
CONTRACT_INACTIVE           CONTRACT_DATE_OUTSIDE_TERM CONTRACT_FEE_EXCEEDED
CONTRACT_RATE_EXCEEDED      CONTRACT_MONTHLY_CAP_EXCEEDED
UNVERIFIED_BANK_CHANGE
```

Duplicate severities: `EXACT_DUPLICATE` (same vendor + same number once
formatting is normalized, including reformatted numbers) is `BLOCK`;
`POSSIBLE_DUPLICATE` (near amount/date, or already paid by card) and
`CARD_INVOICE` (same vendor/amount within the card window) are `WARNING`.

Validation rules:

- Tax is checked against the **place of supply** (`ship_to_province`), using
  the supplied tax-code rates. ON uses HST; BC adds PST on `goods` lines only;
  QC adds QST; other Canadian provinces use GST; US/foreign vendors and
  insurance vendors are expected to charge no Canadian tax. Missing province or
  missing tax-code data is a `WARNING`; wrong/missing tax, a tax code not valid
  for the province, or tax charged to an exempt/foreign vendor is `BLOCK`.
- A PO/contract reference extracted from the document is resolved to the master
  record. A reference that cannot be resolved is `BLOCK`
  (`PO_NOT_FOUND`/`CONTRACT_NOT_FOUND`). A vendor with `requires_po=yes` and no
  PO is `WARNING` (`PO_REQUIRED_MISSING`).
- Cumulative PO spend and contract monthly caps include historical invoices on
  the same PO/contract and exclude the invoice being analyzed. Exceeding either
  cap is `BLOCK`.
- Rate-card lines above the contract hourly-rate cap are `WARNING`.

### 5.4 Resolving a finding

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

### 5.5 Editing an invoice (PATCH)

```
PATCH  /api/invoices/{id}/   -> Invoice   (AP_CLERK, FINANCE_MANAGER, CONTROLLER; DRAFT/REVIEW only)
```

Partial update, `application/json` (multipart is only for upload). Unknown fields
are rejected with `400 VALIDATION_ERROR`.

Allowed header fields: `vendor_id`, `invoice_number`, `invoice_date`,
`received_date`, `due_date`, `currency`, `subtotal`, `total`, `tax_lines`
(array of `{ tax_code, amount }`; `rate` is recomputed from the code),
`ship_to_province`, `department_id`, `requester_id`, `po_id`, `contract_id`.

Line coding is a partial, per-line update keyed by `line_no`:

```json
{
  "department_id": "D01",
  "vendor_id": "V015",
  "ship_to_province": "AB",
  "lines": [
    { "line_no": 1, "gl_account": "5010", "department_id": "D01" }
  ]
}
```

- Each `lines[]` entry is matched by `line_no`; only the fields present on the
  entry change. Unknown `line_no` → `400 VALIDATION_ERROR`.
- Per line you may set `gl_account` (a valid `account_number`) and
  `department_id`. Setting both to the suggested values = "accept suggestion";
  setting different values = an override. Either writes an audit event
  (before/after).
- `PATCH` persists data and does **not** re-run analysis. Call
  `POST /invoices/{id}/analyze/` afterwards to recompute findings and
  `validation_status`.
- To clear a `BLOCK`, fix the underlying field via `PATCH` and re-analyze;
  `resolve-finding` only handles `WARNING`s.
- Editable only in `DRAFT` or `REVIEW`; otherwise `409 INVALID_STATE_TRANSITION`.

## 6. Vendors & bank changes (feature 9)

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

- Onboarding creates `pending_review`. Invoices for `on_hold` or
  `pending_review` vendors get a `VENDOR_ON_HOLD` BLOCK finding; unknown vendors
  get `VENDOR_UNKNOWN`.
- **Reads**: vendor list/detail are available to any authenticated user (bank
  details masked); bank-change history is `AP_CLERK`/`FINANCE_MANAGER`/
  `CONTROLLER`/`AUDITOR`. `on_leave` users may read but not perform writes.
- **Writes**: onboard/PATCH/approve/hold/unhold are `FINANCE_MANAGER`/
  `CONTROLLER`. `hold` is only valid from `active` (a `pending_review` vendor is
  already blocked). A bank-change **request** may also be made by `AP_CLERK`;
  approve/reject is `FINANCE_MANAGER`/`CONTROLLER`, and the requester cannot
  decide their own change.
- **One pending change per vendor.** A second request while one is `PENDING`
  returns `409 INVALID_STATE_TRANSITION`.
- Bank details are never directly `PATCH`-able (attempting it is
  `400 VALIDATION_ERROR`). A request creates a `PENDING` `BankChange`; approval
  applies the new account (4-32 digits) to the vendor and sets
  `verified_by_callback: "yes"`. A rejected change is not applied, does not
  retain the account number, and does not trigger `UNVERIFIED_BANK_CHANGE`.
- `pending_bank_change` on `Vendor` is the masked pending change (or `null`).
- Bank account numbers are masked in every response and log.

**Vendor**

```json
{
  "id": "V015",
  "legal_name": "Polar Freight Lines Ltd.",
  "category": "Freight",
  "default_gl_account": "5010",
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
  "status": "PENDING",
  "changed_at": "2026-01-14",
  "requested_by_id": "U020",
  "request_channel": "api",
  "verified_by_callback": "no",
  "old_account_last4": "4821",
  "new_account_last4": "9933",
  "note": "Called vendor on the number on file",
  "decided_by_id": null,
  "decided_at": null
}
```

Historical dataset rows predate the controlled workflow, so `status`,
`decided_by_id`, and `decided_at` are `null` for them; do not infer a status from
`verified_by_callback`. New changes use `PENDING`/`APPROVED`/`REJECTED`, and an
approval applies the new bank account to the vendor.

## 7. Approvals, policies & delegation (feature 6)

```
GET    /api/approvals/                  -> paginated Approval (filters: invoice_id, status, mine, actionable)
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
- `mine=true` filters to steps assigned to the caller (directly, via an active
  delegate, or role fallback) **regardless of status**; combine with
  `status=PENDING` for decisions awaiting them.
- `actionable=true` returns only what the caller can act on now: assigned to
  them, `status=PENDING`, and the invoice is in `PENDING_APPROVAL`.

### 7.1 Submit routes atomically (3A)

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

### 7.2 Approval policies (admin-editable, audited)

```
GET    /api/policies/          -> paginated Policy   (CONTROLLER, AUDITOR)
POST   /api/policies/          -> Policy             (CONTROLLER)
GET    /api/policies/{id}/     -> Policy
PATCH  /api/policies/{id}/     -> Policy             (CONTROLLER)
DELETE /api/policies/{id}/     -> 204                (CONTROLLER; soft-archive, audited)
```

```json
{
  "id": "POL-P02",
  "name": "Over 10,000 CAD",
  "priority": 20,
  "active": true,
  "conditions": {
    "match": "all",
    "rules": [
      { "field": "invoice.total_cad", "op": "gt", "value": "10000" }
    ]
  },
  "steps": [
    { "step_no": 1, "role": "APPROVER", "approver_id": null },
    { "step_no": 2, "role": "FINANCE_MANAGER", "approver_id": null }
  ]
}
```

- **Conditions are a bounded list**, not arbitrary expressions. `match` is
  `all` or `any`; each rule has a whitelisted `field`, an allowed `op`, and a
  typed `value` (max 20 rules).
- Fields: `invoice.total_cad`, `invoice.currency`, `invoice.ship_to_province`,
  `invoice.has_po`, `invoice.has_contract`, `invoice.is_credit_note`,
  `invoice.department_id`, `invoice.requester_id`, `vendor.status`,
  `vendor.category`, `vendor.province_or_state`, `vendor.requires_po`,
  `vendor.is_new`, `vendor.onboarded_at`, `requester.role`,
  `requester.department_id`.
- Operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `contains`,
  `is_null`, `is_not_null` (type-restricted); strings compare
  case-insensitively, money as decimals, dates as ISO dates. A null field only
  matches `is_null`.
- `vendor.is_new` = vendor `pending_review` or onboarded within 90 days.
  `legal_invoice` is vendor category `Legal` (per `approval_policies.csv`).
- **Engine**: all active matching policies are merged (priority order); a
  department-manager step and the "amount above the manager's limit → finance"
  invariant are always ensured (finance is placed before any controller step);
  duplicate role/approver steps are removed; self-approval escalates to the
  manager's manager. If no policy matches, the baseline chain is used. Policies
  with no steps are reference rows and are never executed.
- Steps are sequential (`step_no` assigned 1..n); `role` ∈ `APPROVER`,
  `FINANCE_MANAGER`, `CONTROLLER`; optional `approver_id` must reference an
  enabled user (`is_active=true`) whose role matches the step role, with status
  `active` or `on_leave` plus an active delegate. An active policy requires at
  least one step.
- The resulting `Approval.reason` reflects the policy name (e.g.
  `"Policy Over 10,000 CAD"`).
- `DELETE` soft-archives (`active=false`); every create/update/delete is audited.
- `manage.py seed_policies` seeds the P01–P06 structured defaults (idempotent;
  never overwrites edits). The prose `approval_policies.csv` rows remain loaded
  as inactive reference.
- `rule_type=payment_release` and `rule_type=match` are **not** approval
  policies: payment release limits/separation live in `/api/payments/`, and
  PO/contract matching lives in invoice validation.

### 7.3 Delegation

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

- Principals and delegates must be `APPROVER`, `FINANCE_MANAGER` or
  `CONTROLLER`, and the delegate must be active. A principal cannot have
  overlapping active delegations; `ends_at` is optional for an open-ended
  delegation. `POST` returns `400 VALIDATION_ERROR` for invalid roles, dates or
  overlaps.
- A principal can create/end their own delegation; `CONTROLLER` can do so for
  any principal; `AUDITOR` can read all but cannot write. Other users see only
  delegations where they are principal or delegate.
- `DELETE` ends the active delegation by setting `ends_at` (it keeps history)
  and writes an audit event. Delegated approvals still record
  `delegated_for_id` and an `on_behalf_of_id` audit evidence.
- The dataset's seeded on-leave/delegate pairs are backfilled into this model;
  the legacy `User.delegate` field remains a fallback for old rows.

Actions taken by a delegate return `delegated_for_id` on the approval and set
`on_behalf_of_id` on the audit event.

## 8. Payments (feature 7)

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
- Release is refused (`409 INVALID_STATE_TRANSITION`) when the linked invoice is
  already `PAID` (covers historical `scheduled` payments on paid invoices).
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

## 9. Audit trail & dashboard (feature 8)

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
  "coding_history": [
    {
      "line_no": 1,
      "gl_account": "5010",
      "department_id": "D01",
      "changed_by_id": "U004",
      "changed_at": "2026-09-02T14:06:00Z",
      "source": "ACCEPTED_SUGGESTION"
    }
  ],
  "events": []
}
```

- `invoice`, `approvals`, `payments` and `events` reuse the `Invoice`,
  `Approval`, `Payment` and `AuditEvent` shapes defined elsewhere.
- `coding_history[].source` ∈ `EXTRACTED | ACCEPTED_SUGGESTION | MANUAL`.

**DashboardSummary** (role-aware; uniform `counts` shape)

```json
{
  "role": "APPROVER",
  "counts": {
    "my_submissions": 0,
    "in_review": 0,
    "pending_my_approval": 4,
    "payments_due": 0,
    "open_findings": 0,
    "vendors_pending_review": 0
  },
  "pending_approvals": [],
  "payments_due": [],
  "recent_activity": []
}
```

- `counts` always contains all six keys (zero where not applicable to the role),
  so the client can type it uniformly.
- `pending_approvals` is `Approval[]` (same shape as `GET /approvals/`).
- `payments_due` is `Payment[]` (same shape as `GET /payments/`).
- `recent_activity` is `AuditEvent[]`, scoped to what the role may see.

## 10. Workflow & invariants

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

## 11. Feature coverage

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

Reference data (`/departments/`, `/gl-accounts/`, `/tax-codes/`, §3) underpins
features 3 and 4.

## 12. Frontend mocking guide

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

## 13. Storage mapping notes (implementation detail, not API)

- `invoice_number` (API) ↔ `Invoice.vendor_invoice_number`.
- `id` (API) ↔ each model's natural string primary key
  (`invoice_id`, `vendor_id`, `payment_id`, `department_id`, …); `User.id`
  is `user_id` (`U007`).
- `extraction` (API) ↔ `Invoice.raw_extraction`.
- Historical dataset statuses are normalized on serialization:
  - `Payment.status`: `settled` → `PAID`, `scheduled` → `SCHEDULED`,
    `outstanding` → `SCHEDULED`; new records use the canonical values.
  - `Payment.status` query filters accept canonical values: `SCHEDULED` matches
    stored `scheduled`/`outstanding` and `PAID` matches stored `settled`. The
    legacy lowercase aliases still match their exact stored rows.
  - `Invoice.validation_status`: historical rows were never analyzed, so an
    empty string is serialized as `null`.
  - `Approval.comment`: an undecided step's empty comment is serialized as
    `null`.
- `bank_account` is stored for matching but only `bank_account_masked` is ever
  serialized.
