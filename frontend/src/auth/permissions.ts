// frontend/src/auth/permissions.ts
//
// The role × capability matrix from docs/API_CONTRACT.md §2.2. The server is
// authoritative for every check; these helpers only decide which controls the
// UI should offer or explain.

import type { UserRole } from '../api/services'

export const EDIT_INVOICE_ROLES = new Set<string>([
  'AP_CLERK',
  'FINANCE_MANAGER',
  'CONTROLLER',
])

export const DECISION_ROLES = new Set<string>([
  'APPROVER',
  'FINANCE_MANAGER',
  'CONTROLLER',
])

export const PREPARE_PAYMENT_ROLES = new Set<string>([
  'AP_CLERK',
  'FINANCE_MANAGER',
  'CONTROLLER',
])

export const RELEASE_PAYMENT_ROLES = new Set<string>([
  'FINANCE_MANAGER',
  'CONTROLLER',
])

export const AUDIT_ROLES = new Set<string>(['CONTROLLER', 'AUDITOR'])

export const INBOX_READ_ROLES = new Set<string>([
  'AP_CLERK',
  'FINANCE_MANAGER',
  'CONTROLLER',
  'AUDITOR',
])

export const INBOX_WRITE_ROLES = new Set<string>([
  'AP_CLERK',
  'FINANCE_MANAGER',
  'CONTROLLER',
])

export const VENDOR_WRITE_ROLES = new Set<string>([
  'FINANCE_MANAGER',
  'CONTROLLER',
])

export const BANK_CHANGE_REQUEST_ROLES = new Set<string>([
  'AP_CLERK',
  'FINANCE_MANAGER',
  'CONTROLLER',
])

export const BANK_CHANGE_READ_ROLES = new Set<string>([
  'AP_CLERK',
  'FINANCE_MANAGER',
  'CONTROLLER',
  'AUDITOR',
])

export const POLICY_ADMIN_ROLES = new Set<string>(['CONTROLLER'])

export const POLICY_READ_ROLES = new Set<string>(['CONTROLLER', 'AUDITOR'])

export const USER_ADMIN_ROLES = new Set<string>(['CONTROLLER'])

export const EDITABLE_INVOICE_STATUSES = new Set<string>([
  'DRAFT',
  'REVIEW',
])

export function canEditInvoice(role: UserRole | string): boolean {
  return EDIT_INVOICE_ROLES.has(role)
}

export function canEditInvoiceInStatus(status: string): boolean {
  return EDITABLE_INVOICE_STATUSES.has(status)
}

export function canEditInvoiceNow(
  role: UserRole | string,
  status: string
): boolean {
  return canEditInvoice(role) && canEditInvoiceInStatus(status)
}

export function canUploadInvoice(role: UserRole | string): boolean {
  return canEditInvoice(role)
}

export function canRunAnalysis(
  role: UserRole | string,
  status: string
): boolean {
  return canEditInvoiceNow(role, status)
}

export function canResolveFindings(
  role: UserRole | string,
  status: string
): boolean {
  return canEditInvoiceNow(role, status)
}

export function canSubmitInvoice(
  role: UserRole | string,
  status: string
): boolean {
  return canEditInvoiceNow(role, status)
}

export function canDecideApproval(role: UserRole | string): boolean {
  return DECISION_ROLES.has(role)
}

export function canPreparePayment(role: UserRole | string): boolean {
  return PREPARE_PAYMENT_ROLES.has(role)
}

export function canReleasePayment(role: UserRole | string): boolean {
  return RELEASE_PAYMENT_ROLES.has(role)
}

export function canViewAudit(role: UserRole | string): boolean {
  return AUDIT_ROLES.has(role)
}

export function canReadInbox(role: UserRole | string): boolean {
  return INBOX_READ_ROLES.has(role)
}

export function canManageInbox(role: UserRole | string): boolean {
  return INBOX_WRITE_ROLES.has(role)
}

export function canManageVendors(role: UserRole | string): boolean {
  return VENDOR_WRITE_ROLES.has(role)
}

export function canRequestBankChange(role: UserRole | string): boolean {
  return BANK_CHANGE_REQUEST_ROLES.has(role)
}

export function canReadVendorBankChanges(
  role: UserRole | string
): boolean {
  return BANK_CHANGE_READ_ROLES.has(role)
}

export function isActiveUser(status: string | undefined): boolean {
  return status === 'active'
}

export function canEditPolicies(role: UserRole | string): boolean {
  return POLICY_ADMIN_ROLES.has(role)
}

export function canReadPolicies(role: UserRole | string): boolean {
  return POLICY_READ_ROLES.has(role)
}

export function canManageUsers(role: UserRole | string): boolean {
  return USER_ADMIN_ROLES.has(role)
}
