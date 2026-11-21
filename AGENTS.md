# AGENTS.md — Brim AP Automation (Harborline Logistics)

Instructions for every human contributor and coding agent in this repository. Read this before changing code.

**Precedence when documents disagree:**

1. `docs/brief.md` — product requirements and judging criteria (source of truth).
2. `docs/API_CONTRACT.md` — the frontend/backend interface, if present.
3. This file — conventions, ownership and workflow.

If code and documentation disagree, inspect the code, raise the discrepancy, and fix the document or the code in a scoped PR. Do not silently pick one.

---

## 1. What we are building

A working web application for fictional **Harborline Logistics Inc.** (40-person Canadian logistics company, ~50 suppliers, ~50 invoices/month) that takes a supplier invoice from **inbox to simulated payment**, with the right people approving each step and a full audit trail. All data is synthetic. **Never initiate a real payment.**

### How we are judged

| Criterion | Weight | What matters |
|---|---:|---|
| Required features (nine, below) | 40% | How many work end to end and how accurately. **Tested on a hidden batch of invoices we have not seen.** |
| Bonus features | 15% | Only scored if required features work. Depth and usefulness beat count. |
| Clean, intuitive UI | 20% | A first-time user in each role can finish their task unaided; flagged items explain themselves. |
| Technical depth (live Q&A) | 25% | Every team member can explain roles, duplicate/mismatch detection, extraction on bad inputs, data modelling, and what breaks at 100x volume. |

A polished feature we cannot explain scores worse than a simpler one we understand. AI-written code is fine, but the author must be able to defend it.

### Datasets

- An **example dataset** is in `datasets/`. Use it for development, seeding and understanding data shapes.
- A **new, unseen dataset will be tested at the presentation.** Code must generalize: no hardcoded vendor names, invoice IDs, PO numbers, amounts, GL accounts or file names.
- Expect differences in volume, IDs, edge cases and possibly minor schema details. Missing files, columns, blanks, unknown vendors and inconsistent identifiers must produce a flagged, reviewable result, never a crash or a silent pass.
- The dataset loader must work on a fresh directory with no code changes. Verify by pointing `DATA_DIR` at a modified copy of the example before the freeze.
- The example dataset contains deliberate mess (see §6). The unseen one will too.

---

## 2. Non-negotiables

- Authorization is enforced **on the server** for every read and mutation. Hiding things in the UI is not authorization.
- Money, tax, limits and state transitions use deterministic code and `Decimal`, never floats and never an LLM.
- AI is for extraction, classification, suggestions and explanations only. AI never approves, releases payment, or bypasses a check.
- Every material action writes an audit event (actor, action, entity, timestamp, before/after or evidence) in the same transaction as the change.
- Nobody approves an invoice they requested; it escalates to their manager. Anyone who approved an invoice cannot release its payment. Delegated actions are recorded as delegated.
- Payment execution is simulated and requires an explicit release by an authorized user.
- Never fabricate extracted fields, bank verification, approvals, payment confirmation or evidence. Uncertain results go to review.
- Do not commit secrets, `.env`, API keys, uploaded invoices, generated artifacts or (see §8) the unseen dataset.
- Do not push directly to `main`; do not force-push shared branches.
- Keep `main` runnable. If a change breaks the demo path, fix or revert it immediately.
- Do not start bonus features until all nine required features have a demonstrable path.

---

## 3. Stack and current repository state

### Stack (decided; do not relitigate)

| Area | Choice |
|---|---|
| Backend | Python, Django + Django REST Framework |
| Frontend | React + TypeScript + Vite |
| Database | SQLite for the hackathon; keep queries Postgres-friendly |
| Auth | Real login endpoint with token/JWT. A demo role switcher is allowed only if it authenticates as a real seeded user. |
| Dev integration | Vite proxy to Django; `django-cors-headers` only if needed |
| Money | `Decimal` everywhere; store invoice currency and CAD amount separately |
| Background work | Synchronous extraction for the demo; note the queue/worker path for scale |

Create the custom `User` model **before the first migration**.

### Current state: parallel work that has not been integrated

Parts of the **automation** (extraction, coding, validation, matching, duplicates, fraud) and the **frontend** were built independently on separate branches. They have not been integrated with a Django backend and may not agree on data shapes.

**Integration is the top priority.** Before writing new code:

1. `git fetch origin` and list branches (`git branch -a`). Do not assume which exist or what they contain.
2. Read the automation and frontend branches. Note what is implemented, what it assumes about inputs/outputs, and what is missing versus the brief.
3. Do **not** reimplement work that already exists. Review it, then integrate it deliberately behind the boundaries in §4.
4. Write down every mismatch (key names, enums, response shapes, field names) and resolve it once in the contract, not ad hoc in two places.
5. Add tests around existing automation modules before extending them.

Known areas to check on integration (verify in code, do not trust this list):

- Automation output keys vs. the canonical envelope in §7 (e.g. `status` vs `validation_status`).
- Whether extraction handles scans and French, or only text PDFs, and whether it validates model JSON.
- Whether coding is per line (brief requires per line) or per invoice.
- Whether tax validation uses province of delivery, and FX uses the invoice-date rate.
- Whether the frontend calls a real API, mocks, or hardcoded data, and which roles it covers.

---

## 4. Architecture and boundaries

```text
React SPA (TypeScript, Vite)  ──typed client──►  Django REST Framework API
                                                        │
                                  Service layer (permissions, transitions, audit, transactions)
                                        │                               │
                                  Django ORM / SQLite        automation/ (pure functions)
                                                                        │
                                                          AI provider (extract/suggest only)
```

Target layout (converge toward it; do not do a disruptive restructure late):

```text
backend/
  manage.py, requirements.txt, .env.example
  config/                 # settings, urls
  apps/accounts/          # custom User, roles, departments, delegations
  apps/vendors/           # vendor master, bank-change controls
  apps/invoices/          # invoices, lines, findings, coding, attachments
  apps/approvals/         # policies, approval steps
  apps/payments/          # simulated payments
  apps/audit/             # append-only audit events
  automation/             # pure functions, no Django imports
  tests/
frontend/                 # src/api, src/features, src/components, src/auth
datasets/                 # example dataset
docs/                     # brief.md, API_CONTRACT.md, decisions.md
```

Boundary rules:

- `automation/` is **pure**: dicts/lists in, findings/suggestions out. No Django imports, ORM, request objects, DB access or side effects. It never changes invoice, approval or payment state.
- Services orchestrate automation, enforce authorization, perform state transitions and write audit events atomically.
- Serializers validate shape only. Permissions and policy live in permission classes and services, not serializers or views.
- The frontend is never authoritative. It hides unavailable actions for usability; the API rejects them independently.
- Never accept `actor_id`, `role` or `approved_by` from the client. Use `request.user`.

---

## 5. Roles, approvals and payment safety

Six roles, from the brief. Enforce on the server.

| Role | Can | Cannot |
|---|---|---|
| Employee (requester) | Submit invoices/requests for own department; track own submissions | Approve, pay, see other departments' invoices |
| AP Clerk | Ingest, review extraction, correct coding, resolve flags, prepare payments | Approve invoices or release payments |
| Approver (dept. manager) | Approve/reject own department's invoices up to their limit; see department spend; delegate while away | Release payments; change vendor bank details |
| Finance Manager | Approve above department limits and for flagged/new vendors; approve vendor changes; release up to **CAD 100,000** | Release a payment for an invoice they approved |
| Controller / Admin | Manage users, roles, approval policies; release any payment; full audit log | Approve or release a payment for an invoice they already approved |
| Auditor | Read everything incl. audit trail; export it | Change anything |

Stored codes: `EMPLOYEE, AP_CLERK, APPROVER, FINANCE_MANAGER, CONTROLLER, AUDITOR`. "Controller / Admin" maps to `CONTROLLER`.

Universal rules:

1. No self-approval; escalate to the requester's manager.
2. An approver cannot release that invoice's payment (separation of duties).
3. Delegated actions record both delegate and principal.
4. Check user status (active / on leave / terminated) and active delegation on every relevant action. The dataset includes an approver on leave with a named delegate and a former employee on old records.
5. Release limits are in CAD; convert foreign currency at the invoice-date FX rate and record the rate.
6. Approval routing is policy-driven (amount, department, vendor status, legal invoices) and admin-editable; edits are audited.
7. Require explicit human release even if an AI recommendation says "approve".

Implementation pattern: coarse role checks in DRF permission classes; object-level policy in services; `transaction.atomic()` per mutation; `select_for_update()` on approval/payment transitions; idempotent release (a retry never creates a second payment); append-only audit with no update/delete endpoints.

### Workflow

```text
DRAFT ─submit→ REVIEW ─route→ PENDING_APPROVAL ─all approved→ APPROVED
                 ▲                    │
                 └──────reject────────┘
APPROVED ─prepare→ Payment SCHEDULED ─release→ Payment PAID ─→ Invoice PAID
```

- Invoice status: `DRAFT, REVIEW, PENDING_APPROVAL, APPROVED, PAID`.
- Payment status: `PREPARED, SCHEDULED, RELEASED, PAID, FAILED, CANCELLED`.
- Approval step status: `PENDING, APPROVED, REJECTED`. A rejection returns the invoice to `REVIEW`.
- Invoice `PAID` is set only by a successful simulated payment, never by an approval action.
- Transitions live in service functions. Invalid transitions return a structured error.

---

## 6. The nine required features

Map every task to one of these. Each needs a demonstrable end-to-end path. Features are tested on hidden data, so favor accuracy and edge-case handling over breadth.

| # | Feature | Must do | Watch for |
|---|---|---|---|
| 1 | Invoice intake | Accept uploads and read the AP inbox; turn each attachment into a draft bill; ignore/route non-invoice emails | Emails with no attachment; non-invoice emails |
| 2 | Data extraction | Read PDFs and scanned images, English and French; capture vendor, invoice no., dates, lines, currency, each tax amount mapped to provided tax codes | Low-quality scans; French; odd dates; malformed output |
| 3 | Smart coding | Suggest GL account and department **per line**, learned from historical invoices, with a reason; user can accept or change | Unknown categories; low confidence; overrides recorded |
| 4 | Validation and matching | Check against vendor master, contract and PO; check tax against province of delivery; check arithmetic | Price above contract, wrong tax, PO problems, arithmetic errors, credit notes, USD |
| 5 | Duplicate detection | Exact, near-exact and reformatted duplicates, including invoices already paid by card | Reformatted numbers, near duplicates, card payments |
| 6 | Approval workflow | Route by amount, department, vendor status, policy; admin-editable rules; delegation and absence; one screen with invoice, coding and approval history | Split invoices to stay under limits; requester cannot approve |
| 7 | Payments | Schedule and release simulated EFT; role release limits; payments dashboard; status per payment | Over-limit release; approver-as-releaser; retries |
| 8 | Audit trail | Record every action, actor, time; link payment to invoice, approval chain and accounting codes in an audit-ready view | Complete invoice → approval → payment trace |
| 9 | Vendor management | Vendor master; onboard new vendors; hold unapproved ones; bank-detail changes as controlled actions | Unverified bank changes; unknown/unapproved vendors; lookalike senders |

Expected real-world mess in the data: duplicates and near-duplicates, prices above contract, incorrect tax, changed bank details, invoices split to stay under approval limits, unknown or unapproved vendors, USD invoices, credit notes, odd dates, PO problems, requesters who cannot approve their own invoices, arithmetic errors, low-quality scans.

**Bonus ideas** (only after all nine work): bank reconciliation, accounting journal export, single-use virtual card payment, early-payment discounts, AI approval recommendations with reasons, plain-language spend questions, spend analytics, mobile/Slack/email approval, suspicious bank-change and lookalike-sender alerts. Depth beats count; be ready to say why it matters to an AP team.

---

## 7. API contract and integration rules

`docs/API_CONTRACT.md` is the interface. Change it in the same PR as the code, and tell the frontend and backend owners. If the contract lacks an endpoint a feature needs (auth, inbox, vendors, policies/delegation, audit, payments), add it deliberately before building against it.

Canonical analysis response (use `validation_status`, not `status`):

```json
{ "validation_status": "PASSED", "findings": [], "coding_suggestions": [], "extraction": {} }
```

`validation_status` is `PASSED`, `WARNING` or `BLOCKED`.

Finding shape: `{ "code": "PO_AMOUNT_EXCEEDED", "severity": "BLOCK" | "WARNING", "message": "...", "evidence": {} }`.

- `BLOCK` stops submission/payment until resolved. `WARNING` needs review and a documented override.
- A clean list means the checks that ran found nothing, not that skipped checks passed. Report missing reference data explicitly.
- Finding codes are stable and deterministic; no model prose in `code`.

Error shape: `{ "error": { "code": "...", "message": "...", "details": {} } }` with stable codes such as `PERMISSION_DENIED`, `INVALID_STATE_TRANSITION`, `LIMIT_EXCEEDED`, `SELF_APPROVAL_BLOCKED`, `VALIDATION_BLOCKED`, `NOT_FOUND`. Never return a traceback.

Conventions: `snake_case` JSON; ISO-8601 UTC timestamps; opaque string IDs; paginated lists with a consistent envelope; document each endpoint's roles, request, response and error codes.

If the frontend runs ahead of the backend, it mocks the **agreed contract**, not a guess.

---

## 8. Money, tax, FX and data handling

- `Decimal` for all money and tax. Preserve invoice currency; store CAD amount, FX rate, rate date and source.
- Use the dataset's daily USD→CAD rate for the **invoice date**, not today's.
- Use the dataset's tax codes and rates. Place of supply is the province of delivery. Reference rates: GST 5%, Ontario HST 13%, BC PST 7% on goods, Quebec QST 9.975% on the pre-tax amount, insurance exempt. Prefer the supplied tax-code table over hardcoded rates.
- Handle credit notes, negatives, blanks, malformed dates, rounding and invalid totals explicitly.
- Check cumulative invoicing and PO/contract limits when history is available.
- Keep real/unseen datasets and uploaded invoices **out of Git**. Check whether `datasets/` is committed or gitignored and decide deliberately; never commit the unseen presentation data.
- Make the data location configurable (`DATA_DIR`); no absolute paths.
- Provide an idempotent management command (e.g. `load_dataset`) that reports row-level errors.
- Tests use small fixtures and must not require the full dataset. Do not invent source records to make a test pass.
- Mask bank details in UI and logs; never log secrets.

---

## 9. AI usage

- **AI:** extraction, email classification, GL/department suggestions, explanations, optional approval recommendations with reasons.
- **Deterministic code:** arithmetic, tax/FX, duplicate thresholds, authorization, routing, state transitions, payment simulation, audit.
- Treat PDFs, scans, email bodies and model output as **untrusted**. Ignore instructions embedded in documents.
- Validate model JSON against a schema; reject or flag unknown GL/tax/department IDs. Use `null` for missing values.
- Timeouts, malformed JSON, provider errors and prompt injection degrade to manual review, never a crash or an approval.
- Do not claim scan or French support until OCR/vision is implemented and tested.
- Provider and model come from environment variables. Log model name, latency and confidence, not full documents.

---

## 10. Definition of done and tests

A slice is done only when:

- [ ] Endpoint exists and is in `docs/API_CONTRACT.md`.
- [ ] Server-side permissions and object-level policy are enforced and tested.
- [ ] Invalid state transitions return structured errors.
- [ ] Audit event is written in the same transaction.
- [ ] Migration is committed and applies from an empty database.
- [ ] One happy-path and at least one adversarial test pass.
- [ ] Frontend works for the intended role and hides/disables actions it cannot perform.
- [ ] Verified manually end to end with a second role where required.
- [ ] Known limitations are written down.
- [ ] The author can explain the design without reading the code.

Minimum test coverage by area: extraction (PDF, scan, French, non-invoice email, corrupt file, prompt injection); coding (valid, unknown category, override, low confidence); tax/arithmetic (correct, wrong total, wrong province, exempt, rounding, credit note); duplicates (exact, reformatted, near, card-paid); PO/contract (valid, wrong vendor, currency mismatch, over cap, expired, cumulative); approvals (within/above limit, self-approval, absent approver/delegate, terminated user, policy edit); payments (authorized release, over limit, approver-as-releaser, retry, failure); fraud/vendor (unapproved vendor, unverified bank change, suspicious sender); audit (every transition recorded, full trace).

Test against unseen-data conditions: unknown vendors, missing keys, inconsistent identifiers, malformed data, unexpected flag combinations. Never hardcode sample IDs or amounts in production logic.

---

## 11. Development workflow

Branches (verify what exists first; see §3):

- `main` is integration-ready and protected.
- Workstream branches: backend (`feature/backend`), frontend (`feature/frontend`), automation (`feature/automation`). Keep changes in the owning branch; do not mix backend and frontend in one PR.
- A cross-cutting change is two PRs: contract/backend first, then frontend.
- Merge `main` into your branch every few hours; merge demoable slices to `main` promptly. Integrate automation and frontend work early, not at the end.
- Short-lived fixes: `fix/<short-description>` from the owning branch.
- Never delete or overwrite teammate work, force-push shared branches or rewrite shared history without agreement.

Start-of-work checklist: fetch; switch to your branch and pull; merge `origin/main`; claim the task on the board; read this file, the relevant brief section, the contract and the code; make the smallest change that completes the slice; run tests and verify the flow manually.

Commands (update once the scaffold exists; do not invent output for missing manifests):

```bash
# Backend
cd backend && python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate && .venv/bin/python manage.py runserver
.venv/bin/pytest

# Frontend
cd frontend && npm install
npm run dev
npm run build
npm test
```

Migrations: one coordinator at a time; never edit an applied migration; commit the migration with its model change.

Hygiene: stage specific files and inspect `git diff --cached`; avoid `git add .` near datasets or generated files; commit `.env.example`, not `.env`; keep `requirements.txt` and `package.json` current. One logical change per commit and PR, with tests and a short explanation a reviewer who did not write it can follow.

---

## 12. Ownership, communication and handoff

| Workstream | Branch | Owner | Backup |
|---|---|---|---|
| Backend / API / auth / audit | `feature/backend` | TBD | TBD |
| Automation / extraction / matching | `feature/automation` | TBD | TBD |
| Frontend / UX | `feature/frontend` | TBD | TBD |
| Data / QA / hardening | tests, fixtures | TBD | TBD |
| Integration / release | `main`, CI | TBD | TBD |

- Announce contract and schema/migration changes in the PR and tag affected owners.
- Record durable decisions in `docs/decisions.md` with context and rationale.
- Short sync every ~3 hours: what shipped, what is blocked, what interface changed.
- Prefer one working walking skeleton over parallel half-features.

Every completed task reports: files changed; behavior added or changed; API contract impact (endpoints, fields, errors, migrations); test command and results; known limitations; whether the PR is ready to merge and what it needs from others.

---

## 13. Priorities and cut order

Timebox: presentation time is **TBD** (fill in). Freeze risky changes 1–2 hours before it and rehearse from a clean checkout.

1. Integrate existing automation and frontend with the Django backend; get **one invoice** through intake → extraction → review → validation → approval by a different user → simulated payment released by another user → audit trail visible.
2. Deepen the nine required features, accuracy first.
3. Vendor management, role-specific screens, hidden-data hardening, core tests.
4. Demo script, backup recording, Q&A notes.
5. Bonus features, only if all nine work.

If behind, cut in this order: bonus features; OCR/French depth (keep text PDFs plus manual correction); contract/PO edge cases (keep basic vendor, amount and date checks); full vendor onboarding (keep list and bank-change flag); payments-dashboard polish.

**Never cut:** server-side authorization, separation of duties, the audit trail, the end-to-end flow, or a working demo dataset.

---

## 14. Instructions for AI coding agents

1. Read this file, the relevant part of `docs/brief.md`, the contract and the code you will change.
2. Inspect real branches and files; do not assume anything described here exists.
3. Work on the branch that owns the area. Never implement on `main`.
4. Do not invent data files, endpoints, tests or command output.
5. Make the smallest scoped change; do not reformat or restructure unrelated code.
6. Preserve teammate work; explain any change to shared code.
7. Enforce authorization and audit in the backend, not just the UI.
8. Add or update tests for behavior changes and run them.
9. Never commit secrets, datasets, uploaded documents or generated artifacts.
10. Never push to `main`, force-push, or run destructive git commands without explicit human approval.
11. If requirements conflict or are ambiguous, stop and state the options.
12. Finish with the handoff report from §12.

This file describes conventions and target behavior, not a claim that every feature is implemented. Update it as the repository evolves.
