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
