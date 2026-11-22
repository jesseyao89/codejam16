# Durable decisions

Context and rationale for non-obvious choices. Recorded so the team can explain
them in the live Q&A (AGENTS.md §12).

## Backend scaffold (Nov 2026)

- **uv + Python 3.12.** `uv` manages the venv and lockfile (`uv.lock`). Python
  3.12 is pinned (`.python-version`) because 3.14 is too new for reliable wheels
  on `pymupdf`/`onnxruntime`. Django is pinned to the 5.2 LTS line
  (`django>=5.2,<6.0`).
- **Flat layout.** `manage.py` and `config/` sit at `backend/`, with `apps/*`
  and `automation/` beside them. `automation/` stays importable as a pure
  top-level package with **no Django imports** (AGENTS.md §4 boundary).

## Data modelling

- **Natural string primary keys for domain models.** The dataset uses opaque
  string ids throughout (`V001`, `D01`, `AP-00001`, `PO-2026-0001`, `C001`), and
  AGENTS.md §7 requires opaque string ids in the API. We therefore use those
  ids as `CharField(primary_key=True)` on `Vendor`, `Department`, `Invoice`,
  `PurchaseOrder`, `Contract`, `GLAccount`, `TaxCode`, `BankChange`, `Payment`,
  `ApprovalPolicy`, `ApprovalStep`, etc. FKs store the string id directly, so
  `load_dataset` needs no id-mapping.
- **`User` is the exception.** It extends `AbstractUser` (auto `id` PK) so it can
  be the auth user. The dataset id is kept in `User.user_id` (unique) and
  `username` is seeded from it. FKs to `User` are resolved in `load_dataset` via
  a cache (`dict[str, User]`) rather than `to_field`.

## Enum mapping (dataset -> canonical)

The dataset's role codes are snake_case; AGENTS.md §5 mandates uppercase. The
loader maps:

| Dataset value | Stored value |
|---|---|
| `employee` | `EMPLOYEE` |
| `ap_clerk` | `AP_CLERK` |
| `approver` | `APPROVER` |
| `finance_manager` | `FINANCE_MANAGER` |
| `controller_admin` | `CONTROLLER` |
| `auditor` | `AUDITOR` |
| approvals `dept_manager` | `APPROVER` |

Historical invoice `status` values (`approved`, `paid`, `rejected`, `scheduled`)
are upper-cased into the canonical workflow statuses (`APPROVED`, `PAID`,
`REJECTED`, `SCHEDULED`); new invoices start at `DRAFT`.

## Automation contract

`analyze_invoice` returns the canonical envelope from AGENTS.md §7:

```json
{ "validation_status": "PASSED|WARNING|BLOCKED", "findings": [], "coding_suggestions": [], "extraction": {} }
```

The AI coding step degrades gracefully: a provider error (missing key, timeout,
malformed JSON) yields `coding_suggestions: []` and never crashes analysis.
Deterministic validation/matching findings are unaffected.

## Frontend alignment (Nov 2026)

Answers to the frontend team's integration questions; encoded in
`docs/API_CONTRACT.md` §0.1 and the sections cited there.

- **Auth (1A).** Every seeded user shares one fake demo password (`demo1234`);
  the username is the dataset `user_id`. The list is in `docs/DEMO_USERS.md`.
  Login is `POST /api/auth/login/` and returns a DRF token. No signup and no
  role-switcher endpoint.
- **Intake (2A).** Upload/ingest always creates a reviewable `DRAFT`.
  Extraction failure, a corrupt file, or an unknown vendor becomes a `BLOCK`
  finding (`EXTRACTION_FAILED`, `EXTRACTION_UNREADABLE`, `VENDOR_UNKNOWN`) —
  never an error and never invented data.
- **Routing (3A).** `submit` validates and routes atomically to
  `PENDING_APPROVAL`; the chain (with a `reason` per step) is returned on the
  invoice as `approvals`. There is no separate routing endpoint.
- **Payments (4A).** `release` is the explicit human release and the simulated
  execution in one transaction, setting Payment and Invoice `PAID`. `RELEASED`
  is not a resting state.
- **Findings (5B).** Findings carry a deterministic `finding_id` and a
  `resolution` object; `resolve-finding` targets `finding_id`; `validation_status`
  counts open findings only; a `BLOCK` is never resolvable.

## Frontend API-mismatch fixes (Nov 2026)

The frontend surfaced six read-API mismatches. Resolutions:

1. **Payment status normalization.** The serializer maps historical dataset
   values: `settled → PAID`, `scheduled → SCHEDULED`, `outstanding → SCHEDULED`;
   new rows already use canonical values.
2. **`Invoice.validation_status`.** Historical rows (never analyzed) serialize
   the empty string as `null`.
3. **`Approval.comment`.** An undecided step's empty comment serializes as
   `null`.
4. **Approvals `mine` / `actionable`.** `mine=true` means assigned-to-me
   regardless of status; the new `actionable=true` returns assigned-to-me,
   `status=PENDING`, on a `PENDING_APPROVAL` invoice.
5. **FX / `total_cad` on upload.** CAD invoices now set `total_cad = total` and
   `fx_rate_to_cad = 1.0`; USD invoices use the invoice-date `FXRate` when
   available (otherwise the values stay null).
6. **Release on a paid invoice.** `release` now refuses
   (`409 INVALID_STATE_TRANSITION`) when the linked invoice is already `PAID`,
   covering historical `scheduled` payments.

Contract updates applied to `docs/API_CONTRACT.md`: §7 filter list (`actionable`,
plus `mine` vs `actionable` semantics), §8 release refusal when the invoice is
already `PAID`, and §13 normalization mappings.

## Inbox (Nov 2026)

- **Email metadata is stored; attachment files are not.** `Email` +
  `EmailAttachment` mirror the inbox source (`inbox/emails.json` in dev); files
  stay on disk. The DB holds classification/status/links so the API can list,
  filter, ingest, dismiss and audit.
- **The attachment is the ingestion unit.** One draft per attachment (the brief
  says "each email attachment"), so an email with two invoice PDFs produces two
  drafts. `EmailAttachment.invoice` + status carry the links; a single
  `Email.invoice` was insufficient (EM-029 has invoices 279 and 281).
- **Classification is deterministic.** Filename/subject/body heuristics classify
  emails as INVOICE / NOT_INVOICE / UNCERTAIN; non-invoices and no-attachment
  emails are ROUTED and never drafted. AI classification can layer on later.
- **Sync vs ingest.** `sync` reloads/classifies and auto-ingests invoice emails;
  `ingest` handles one email (all attachments, or one by filename) and is
  idempotent per attachment. `manage.py sync_inbox` runs the same service from
  the CLI for demo seeding (synchronous; calls the AI extractor).
- **Failures are reviewable.** Missing/unreadable attachments produce a draft
  with `EXTRACTION_UNREADABLE`; extraction failures produce `EXTRACTION_FAILED`.
  PNG scans currently fail text extraction and land as blocked drafts (OCR is a
  later hardening item).

## Vendor writes (Nov 2026)

- **Onboarding + lifecycle.** `POST /api/vendors/` creates `pending_review` with
  a generated `V###` id; approve/hold/unhold are Finance/Controller actions.
  Invoices for non-active vendors get a `VENDOR_ON_HOLD` BLOCK.
- **Bank details are a controlled action.** `PATCH` cannot touch bank fields
  (400). A request creates a `PENDING` `BankChange` (the full new account is
  stored but never serialized; only last4 is exposed). Approval applies it to
  the vendor and sets `verified_by_callback="yes"`; rejection leaves the vendor
  unchanged.
- **Separation of duties.** The requester cannot approve/reject their own bank
  change.
- **Historical rows.** Dataset bank changes keep `status`/`decided_*` null (they
  predate the workflow); new changes use PENDING/APPROVED/REJECTED.
- **One pending change at a time.** A second request while one is pending is
  `409`; decisions lock the change and the vendor. A rejected change clears the
  stored account and is excluded from `UNVERIFIED_BANK_CHANGE` (it was never
  applied).
- **Status handling.** Vendor statuses from the dataset are case/format
  normalised (`Active` → `active`, `on-hold` → `on_hold`); unknown values default
  to `pending_review` and are logged. `hold` is only valid from `active`;
  `on_leave` users can read but not write.
- **PATCH validation.** Vendor input is validated through a serializer (shape
  only): blank `legal_name`, invalid types, and unknown fields are `400`; bank
  fields are never accepted here.
- **Audit.** `VENDOR_ONBOARDED/UPDATED/APPROVED/HELD/UNHELD` and
  `BANK_CHANGE_REQUESTED/APPROVED/REJECTED`.

## Approval policies (Nov 2026)

- **Structured, bounded conditions.** Policies are editable data (`/api/policies/`)
  with a flat whitelisted `{field, op, value}` list (`match: all|any`), not
  arbitrary expressions. This covers amount tiers, vendor status/category,
  currency, province, PO/contract presence, credit notes and requester fields
  while staying deterministic and testable.
- **Seeding.** `seed_policies` creates P01–P06 structured defaults by fixed ID
  (`get_or_create`; never overwrites edits). The dataset's prose rows stay
  inactive reference. `payment_release` and `match` rows remain handled in
  payments and validation, not the approval engine.
- **Engine.** Additive merge of matching policies by priority, dedupe by
  `(role, approver)`, invariant manager step + finance above the manager's
  limit, self-approval escalation, baseline fallback. `ApprovalStep.reason`
  records the policy that produced each step.
- **Partial updates.** A `PATCH` that omits `conditions`/`steps` leaves them
  untouched; only an explicit `null` conditions value means "no conditions".
- **Manager resolution.** Terminated managers, and on-leave managers without an
  active delegate, escalate up the management chain; on-leave managers with a
  delegate stay on the step and the delegate acts. Only approver-capable roles
  (`APPROVER`, `FINANCE_MANAGER`, `CONTROLLER`) are assigned. Escalated
  approvers and active delegates can see and act on invoices outside their own
  department; unrelated cross-department invoices stay hidden.
- **Actions require an active principal.** `status=on_leave`/`terminated` or
  `is_active=False` users cannot approve directly, even for a step assigned to
  them — the delegate acts and the step records `delegated_for`.
- **Malformed policies fail closed.** Stored policies with a non-object
  `conditions`/malformed `rules` never match, rather than becoming
  unconditional.
- **Definitions.** `new_vendor` = `pending_review` or onboarded within 90 days;
  `legal_invoice` = vendor category `Legal` (per `approval_policies.csv`, not GL).
- **Controller routing.** P03/P04 add `CONTROLLER` steps for large amounts; this
  supersedes the earlier "Controller is not a routing target" note. Separation of
  duties still blocks approving your own request or releasing your own approval.
- **CFO.** P04's `cfo` maps to `CONTROLLER` (the six-role model has no CFO).

### Policy engine known limitations

- A department with no resolvable approver (no manager chain) still creates an
  unassigned `APPROVER` step; a large invoice there is not automatically
  escalated to finance unless the amount is missing CAD or the vendor is not
  active. The sample data always resolves a manager.
- Generated `rule_id`s use 8 hex characters; a collision would fail the create
  (no retry loop), which is acceptable at demo scale.
- Merging many policies can exceed the per-policy 10-step cap; the engine does
  not cap the merged chain.
- Each submit evaluates policies and resolves approvers with a handful of
  queries (`lines` existence, per-step user lookups); fine at 50 invoices/month
  and small at 100x, but worth caching if submit is ever batched.

## Known limitations / next steps

- Extraction is **text-PDF only** (no OCR, no proven French/scan support) and
  uses a hardcoded model name; these are tracked as discrepancies vs. AGENTS.md §9.
- Smart coding is **per-invoice**, not per-line, and suggests no department.
- Duplicate detection covers exact and reformatted numbers (`EXACT_DUPLICATE`,
  `BLOCK`) and near matches by vendor + amount + currency within a 7-day window
  (`POSSIBLE_DUPLICATE`, `WARNING`). Historical references now carry the payment
  method (joined from `Payment` in `build_reference_data`), so duplicate findings
  include `paid_by` (e.g. `CARD`); a standalone "already paid by card" rule
  independent of the amount/date match is still not implemented.
- Tax validation checks arithmetic only, **not province of delivery**.
- Vendor resolution is **exact normalized-name match**; fuzzy matching, PO and
  contract association are not yet extracted by the AI.
- Inbox has no live mail source: it syncs the dataset JSON. `sync`/`ingest` are
  synchronous and call the AI extractor per attachment; `manage.py sync_inbox`
  is the CLI path for pre-demo seeding.
