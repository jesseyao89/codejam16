# Brim AP Automation — API Contract v1

## Technology
- Frontend: React + TypeScript
- Backend: Django REST Framework
- Database: SQLite
- Automation: Python modules called directly by Django

## API Base
/api/

## Invoice Endpoints
GET    /api/invoices/
POST   /api/invoices/upload/
GET    /api/invoices/{id}/
PATCH  /api/invoices/{id}/
POST   /api/invoices/{id}/analyze/
POST   /api/invoices/{id}/submit/

## Approval Endpoints
GET    /api/approvals/
POST   /api/approvals/{id}/approve/
POST   /api/approvals/{id}/reject/

## Payment Endpoints
GET    /api/payments/
POST   /api/payments/prepare/
POST   /api/payments/{id}/release/

## Other Endpoints
GET    /api/vendors/
GET    /api/dashboard/
GET    /api/invoices/{id}/audit/

## Automation Interface

extract_invoice(file_path: str) -> dict

analyze_invoice(
    invoice_data: dict,
    reference_data: dict
) -> dict

## Standard Analysis Response

{
  "extraction": {},
  "coding_suggestions": [],
  "findings": [],
  "validation_status": "PASSED"
}

## Validation Finding

{
  "code": "POSSIBLE_DUPLICATE",
  "severity": "WARNING",
  "message": "Similar invoice found",
  "evidence": {}
}

## Severity
WARNING: Can be overridden with documented justification.
BLOCK: Must be resolved before submission.

## Validation Status
PASSED
WARNING
BLOCKED

## Invoice Workflow
DRAFT -> REVIEW -> PENDING_APPROVAL -> APPROVED -> PAID

Rejected invoices return to REVIEW.

## Rules
- Every invoice requires AP Clerk review.
- Approvals are sequential.
- AP Clerks cannot approve invoices.
- AP Clerks cannot release payments.
- Invoice approvers cannot release their invoice's payment.
- Payment execution is simulated.
- Automation never directly approves or pays invoices.
- All important actions must be audited.