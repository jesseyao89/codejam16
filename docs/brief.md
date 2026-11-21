# Brim Hackathon Brief: AP Automation for Business Cards

## 1. Context

You and your team will build an accounts payable (AP) automation for a business card platform.

Small and mid-sized businesses spend on the card but pay supplier invoices outside the platform, in email threads, spreadsheets and the accounting system. AP automation closes that gap: invoices arrive, get read and coded, get approved by the right people, and get paid from the same platform that issues the card.

**Your role.** You are the product and engineering team for this feature. Deliver a working web application that takes a supplier invoice from inbox to payment, with the right people approving each step and a full audit trail afterward.

**The customer you are building for.** Harborline Logistics Inc. (fictional) is a 40-person Canadian logistics company with offices in Toronto, Vancouver, Calgary and Montréal. Its finance team works with about 50 suppliers and processes around 50 invoices a month.

**Canadian context.** Invoices carry GST/HST or provincial taxes (PST/QST), amounts are mostly CAD with some USD, suppliers are paid by EFT, and records need to be audit-ready for the CRA.

**FYI**

- All data is synthetic. No real payments move; payment execution is simulated.

- Use any language, framework or AI tooling you like, including LLMs for extraction and coding.

- Your team must be able to explain every design decision, including the ones an AI wrote.

## 2. Sample data

Each team receives a synthetic dataset for Harborline Logistics covering ten months of AP history (January to October 2026) plus a fresh batch of unprocessed invoices to run through your system. Nothing in it is real: names, tax numbers and bank details are fictional.

| Dataset                | What is in it                                                                                                                                                                                           | Use it for                                     |
|------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------|
| Org structure          | 8 departments and about 40 users, each with a role, manager, approval limit and work province. One approver is on leave with a named delegate, and one former employee is still named on older records. | Role-based access, approval routing            |
| Approval policies      | A starter set of rules: amount thresholds, extra steps for new vendors and legal invoices, and who may release payments.                                                                                | Configurable approval workflows                |
| Chart of accounts      | About 30 general ledger accounts, plus the tax receivable and payable accounts.                                                                                                                         | Invoice coding                                 |
| Tax codes              | GST, Ontario HST, BC PST, Quebec QST, exempt, and foreign, each with its rate and whether it is recoverable.                                                                                            | Tax capture and validation                     |
| Vendor master          | About 55 suppliers with legal name, category, default account, address, tax numbers, payment terms, preferred payment method, fake bank details and status.                                             | Vendor management, validation                  |
| Bank change history    | Dated changes to supplier bank details, with who requested them and whether they were verified.                                                                                                         | Payment fraud controls                         |
| Contracts              | About 25 supplier contracts with fees, rate caps, spending limits and end dates.                                                                                                                        | Matching invoices to contracts                 |
| Purchase orders        | About 60 POs with amounts, status and requester.                                                                                                                                                        | PO matching                                    |
| Historical invoices    | About 450 invoices with line items, coding, approvals and payment outcomes.                                                                                                                             | Learning coding patterns, training and testing |
| Approvals and payments | The approval trail and payment record for each historical invoice.                                                                                                                                      | Audit trail, reconciliation                    |
| Bank statement         | Debits matching the historical EFT and cheque payments, plus a few fees and unexplained items.                                                                                                          | Payment reconciliation                         |
| Brim card transactions | About 600 card transactions, including supplier payments made by virtual card.                                                                                                                          | Card and AP in one view                        |
| FX rates               | Daily USD to CAD rates for 2026.                                                                                                                                                                        | Foreign currency invoices                      |
| Incoming invoices      | About 55 new invoices as PDFs and scanned images, including a few in French.                                                                                                                            | Capture and extraction                         |
| AP inbox               | The emails the invoices arrived in, with sender, subject and body. Some have no attachment, and a few are not invoices at all.                                                                          | Email ingestion, classification                |

**Expect real-world mess.** The incoming batch and the history include duplicate and near-duplicate invoices, prices above contract, tax charged incorrectly, changed bank details, invoices split to stay under an approval limit, unknown or unapproved vendors, USD invoices, credit notes, odd dates, PO problems, requesters who cannot approve their own invoices, arithmetic errors, and low-quality scans. Finding these is part of the job.

## 3. Standard feature set: focus on a few and implement them well

### Role-based feature control

Every user in the sample data has one of six roles. What each person sees and can do must change with their role, and the rules must be enforced on the server, not only hidden in the interface.

| Role                          | Can                                                                                                                              | Cannot                                                            |
|-------------------------------|----------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| Employee (requester)          | Submit invoices or requests for their department, and track the status of their own submissions                                  | Approve, pay, or see other departments' invoices                  |
| AP Clerk                      | Ingest invoices, review extracted data, correct coding, resolve flags, and prepare payments                                      | Approve invoices or release payments                              |
| Approver (department manager) | Approve or reject their department's invoices up to their limit, see department spend, and delegate while away                   | Release payments or change vendor bank details                    |
| Finance Manager               | Approve above department limits and for flagged or new vendors, approve vendor changes, and release payments up to $100,000 CAD | Release a payment for an invoice they approved                    |
| Controller / Admin            | Manage users, roles and approval policies, release any payment, and view the full audit log                                      | Approve or release a payment for an invoice they already approved |
| Auditor                       | Read everything, including the audit trail, and export it                                                                        | Change anything                                                   |

Two rules apply to every role. Nobody approves an invoice they requested; it escalates to their manager instead. Anyone who approves an invoice cannot release its payment. Actions taken by a delegate must be recorded as such.

### Standard features

| #  | Feature                 | What it must do                                                                                                                                                                                                               |
|-----|-------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1   | Invoice intake          | Accept uploads and read the AP inbox, turning each email attachment into a draft bill for review. Ignore or route emails that are not invoices.                                                                               |
| 2   | Data extraction         | Read PDFs and scanned images, in English and French, and capture vendor, invoice number, dates, line items, currency and each tax amount, mapped to the tax codes provided.                                                   |
| 3   | Smart coding            | Suggest a general ledger account and department for each line, learned from the historical invoices, and show why. A person can accept or change each suggestion.                                                             |
| 4   | Validation and matching | Check each invoice against the vendor master, contract and PO, and flag discrepancies before payment. Check tax against the province of delivery and check the arithmetic.                                                    |
| 5   | Duplicate detection     | Catch exact, near-exact and reformatted duplicates, including invoices already paid by card.                                                                                                                                  |
| 6   | Approval workflow       | Route each bill to the right approvers by amount, department, vendor status and policy. Let an admin edit the rules, handle delegation and approver absence, and show the invoice, coding and approval history on one screen. |
| 7   | Payments                | Schedule and release supplier payments by simulated EFT, with release limits by role, a payments dashboard, and a status for each payment.                                                                                    |
| 8   | Audit trail             | Record every action, who took it and when, and link each payment back to its invoice, approval chain and accounting codes in an audit-ready view.                                                                             |
| 9   | Vendor management       | Show the vendor master, onboard new vendors, hold unapproved ones, and treat any change of bank details as a controlled action.                                                                                               |

### Bonus features

Bonus features are scored only if the required features work. Ideas, with no limit on others:

- Reconcile payments to the bank statement and explain unmatched items.

- Export approved invoices and payments as a journal for an accounting system.

- Pay a supplier with a single-use Brim virtual card where the vendor accepts cards.

- Capture early-payment discounts, and suggest the best day to pay each invoice.

- Recommend an approval decision with a reason, and flag items that need a closer look.

- Ask questions about spend in plain language, such as "what did Operations spend on freight last quarter?"

- Show spend analytics by vendor, department and category.

- Approve from a phone, or from Slack or email.

- Alert on suspicious changes to vendor bank details or lookalike senders.

- Anything else you think an AP team would pay for. Tell us why it matters.

## 4. How you will be judged

Judges score four things, and working software counts for the most. Required features are tested on a hidden batch of invoices your team has not seen.

| Criterion           | Weight | What judges look for                                                                                                                                                                                                                                  |
|---------------------|--------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Required features   | 40%    | How many of the nine features work end to end, and how accurately.                                                                                                                                                                                    |
| Bonus features      | 15%    | Features beyond the required nine that an AP team would use. Depth and usefulness beat count.                                                                                                                                                         |
| Clean, intuitive UI | 20%    | A first-time user in each role can finish their task without help. Screens show the right information for the role, and flagged items explain themselves.                                                                                             |
| Technical depth     | 25%    | Every team member can answer hard questions about the design: how roles are enforced, how duplicates and mismatches are detected, how extraction handles bad inputs, why the data is modelled as it is, and what would break at 100 times the volume. |

Technical depth is judged in a live Q&A, so using AI to write code is fine, but you must be able to explain and defend it. A polished demo that the team cannot explain will score lower than a simpler one it fully understands.
