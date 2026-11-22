// frontend/src/api/services.ts

import { api, type PaginatedResponse } from './client'

// -------------------------------------
// TYPES
// -------------------------------------

export type UserRole =
  | 'EMPLOYEE'
  | 'AP_CLERK'
  | 'APPROVER'
  | 'FINANCE_MANAGER'
  | 'CONTROLLER'
  | 'AUDITOR'

export type ValidationStatus = 'PASSED' | 'WARNING' | 'BLOCKED'

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

// Canonical payment states (contract §1.3). The read API normalizes the
// dataset's historical statuses to these values.
export type PaymentStatus =
  | 'PREPARED'
  | 'SCHEDULED'
  | 'RELEASED'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'

export interface Department {
  id: string
  name: string
  cost_centre?: string
  annual_budget_cad?: string | null
  manager_id?: string | null
}

export interface User {
  id: string
  username: string
  full_name: string
  role: UserRole
  email: string
  title?: string
  department?: Department | null
  manager_id?: string | null
  delegate_id?: string | null
  approval_limit_cad?: string | null
  work_province?: string
  status?: string
}

export interface Vendor {
  id: string
  legal_name: string
  status: string
}

export type BankChangeStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface BankChange {
  id: string
  vendor_id: string
  status: BankChangeStatus | null
  changed_at: string | null
  requested_by_id: string | null
  request_channel: string
  verified_by_callback: string
  old_account_last4: string | null
  new_account_last4: string | null
  note: string
  decided_by_id: string | null
  decided_at: string | null
}

export interface VendorDetail {
  id: string
  legal_name: string
  category: string
  default_gl_account: string | null
  address: string
  province_or_state: string
  country: string
  gst_hst_number: string
  qst_number: string
  payment_terms_days: number | null
  early_pay_discount: string
  preferred_payment_method: string
  accepts_card_payment: string
  bank_institution: string | null
  bank_account_masked: string | null
  bank_details_updated_at: string | null
  ap_contact_email: string
  requires_po: string
  status: string
  onboarded_at: string | null
  pending_bank_change: BankChange | null
}

export interface VendorWritePayload {
  legal_name?: string
  category?: string
  default_gl_account?: string
  address?: string
  province_or_state?: string
  country?: string
  gst_hst_number?: string
  qst_number?: string
  payment_terms_days?: number | null
  early_pay_discount?: string
  preferred_payment_method?: string
  accepts_card_payment?: string
  ap_contact_email?: string
  requires_po?: string
}

export interface BankChangeRequest {
  bank_account: string
  note?: string
}

export interface Finding {
  finding_id: string
  code: string
  severity: 'BLOCK' | 'WARNING'
  message: string
  evidence: Record<string, unknown>
  resolution: {
    status: 'RESOLVED'
    resolved_by_id: string
    resolved_at: string
    justification: string
  } | null
}

export interface ApprovalApprover {
  id: string
  full_name: string
  role: string
}

export interface Approval {
  id: string
  invoice_id: string
  step_no: number
  status: ApprovalStatus
  approver: ApprovalApprover | null
  delegated_for_id: string | null
  comment: string | null
  reason: string
  acted_at: string | null
}

// A dated grant of approval authority from a principal to a delegate
// (contract §7.3). `active` is computed by the server for "now"; scheduled and
// ended rows keep their history.
export interface Delegation {
  id: string
  principal_id: string | null
  delegate_id: string | null
  starts_at: string
  ends_at: string | null
  active: boolean
}

export interface DelegationWritePayload {
  principal_id?: string
  delegate_id: string
  starts_at?: string
  ends_at?: string
}

export type PolicyMatch = 'all' | 'any'
export type PolicyRole = 'APPROVER' | 'FINANCE_MANAGER' | 'CONTROLLER'
export type PolicyValue =
  | string
  | boolean
  | number
  | Array<string | boolean | number>
  | null

export interface PolicyRule {
  field: string
  op: string
  value?: PolicyValue
}

export interface PolicyConditions {
  match?: PolicyMatch
  rules?: PolicyRule[]
}

export interface PolicyStep {
  step_no?: number
  role: PolicyRole
  approver_id?: string | null
}

export interface Policy {
  id: string
  name: string
  priority: number
  active: boolean
  conditions: PolicyConditions
  steps: PolicyStep[]
  rule_type?: string
}

export interface PolicyWritePayload {
  name: string
  priority: number
  active: boolean
  conditions: PolicyConditions
  steps: PolicyStep[]
}

export interface TaxLine {
  tax_code: string
  rate?: string
  amount: string
}

export interface InvoiceLine {
  line_no: number
  description: string
  quantity: string
  unit_price: string
  amount: string
  gl_account: string | null
  department_id: string | null
  gst_hst_code?: string
  pst_qst_code?: string
  line_type?: string
}

/**
 * Contract §5.1 expects one suggestion per line. The current API returns a
 * single invoice-level suggestion with `account_number`/`account_name`, so the
 * type accepts both shapes and the UI renders whichever is present.
 */
export interface CodingSuggestion {
  line_no?: number
  suggested_gl_account?: string | null
  suggested_department_id?: string | null
  confidence?: string | null
  reason: string
  account_number?: string
  account_name?: string
}

export interface Invoice {
  id: string
  status: string
  vendor: Vendor | null
  invoice_number: string | null
  invoice_date: string | null
  received_date?: string | null
  due_date: string | null
  currency: string | null
  subtotal?: string | null
  tax_lines?: TaxLine[]
  total: string | null
  fx_rate_to_cad?: string | null
  fx_rate_date?: string | null
  total_cad: string | null
  ship_to_province?: string | null
  department?: Department | null
  requester_id?: string | null
  po_id?: string | null
  contract_id?: string | null
  lines?: InvoiceLine[]
  validation_status: ValidationStatus | null
  findings: Finding[]
  coding_suggestions?: CodingSuggestion[]
  approvals: Approval[]
  created_at?: string | null
  updated_at?: string | null
}

export interface Payment {
  id: string
  invoice_id: string | null
  status: PaymentStatus
  method: string | null
  currency: string | null
  amount: string | null
  fx_rate_to_cad: string | null
  amount_cad: string | null
  discount_taken: string | null
  reference: string | null
  scheduled_date: string | null
  paid_date: string | null
  bank_account_masked: string | null
  prepared_by_id: string | null
  released_by_id: string | null
  failure_reason: string | null
  created_at: string | null
}

export type InboxClassification =
  | 'INVOICE'
  | 'NOT_INVOICE'
  | 'UNCERTAIN'

export type InboxStatus =
  | 'NEW'
  | 'INGESTED'
  | 'PARTIAL'
  | 'ROUTED'
  | 'DISMISSED'

export type InboxAttachmentStatus = 'NEW' | 'INGESTED' | 'FAILED'

export interface InboxAttachment {
  filename: string
  content_type: string
  order: number
  status: InboxAttachmentStatus
  invoice_id: string | null
  error: string
}

export interface InboxEmail {
  id: string
  sender: string
  from_name: string
  subject: string
  received_at: string
  body_excerpt: string
  attachment: { filename: string; content_type: string } | null
  attachments: InboxAttachment[]
  classification: InboxClassification
  classification_confidence: string
  invoice_id: string | null
  invoice_ids: string[]
  status: InboxStatus
}

export interface InboxSyncResult {
  ingested: number
  skipped: number
  routed: number
  failed?: number
}

export interface InboxIngestResult {
  email: InboxEmail
  invoices: Invoice[]
}

export interface DashboardSummary {
  role: string
  counts: {
    my_submissions: number
    in_review: number
    pending_my_approval: number
    payments_due: number
    open_findings: number
    vendors_pending_review: number
  }
  pending_approvals: Approval[]
  payments_due: Payment[]
  recent_activity: AuditEvent[]
}

export interface GLAccount {
  account_number: string
  name: string
  account_type: string
  notes: string
}

export interface AuditEvent {
  id: string
  actor_id: string | null
  actor_name: string | null
  on_behalf_of_id: string | null
  action: string
  entity_type: string
  entity_id: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  evidence: Record<string, unknown> | null
  timestamp: string
}

export interface CodingHistoryEntry {
  line_no: number
  gl_account: string | null
  department_id: string | null
  changed_by_id: string | null
  changed_at: string
  source: string
}

export interface InvoiceTrace {
  invoice_id: string
  invoice: Invoice
  approvals: Approval[]
  payments: Payment[]
  coding_history: CodingHistoryEntry[]
  events: AuditEvent[]
}

export interface AnalysisResponse {
  validation_status: ValidationStatus
  findings: Finding[]
  coding_suggestions: CodingSuggestion[]
  extraction: Record<string, unknown>
}

export interface InvoicePatch {
  vendor_id?: string | null
  invoice_number?: string
  invoice_date?: string | null
  received_date?: string | null
  due_date?: string | null
  currency?: string
  subtotal?: string | null
  total?: string | null
  tax_lines?: Array<{
    tax_code: string
    label?: string
    rate?: string
    amount: string
  }>
  ship_to_province?: string | null
  department_id?: string | null
  requester_id?: string | null
  po_id?: string | null
  contract_id?: string | null
  lines?: Array<{
    line_no: number
    gl_account?: string | null
    department_id?: string | null
  }>
}

// -------------------------------------
// QUERY HELPERS
// -------------------------------------

export interface PageParams {
  page?: number
  page_size?: number
}

export interface ApprovalListParams extends PageParams {
  invoice_id?: string
  status?: ApprovalStatus
  mine?: boolean
  actionable?: boolean
}

export interface PolicyListParams extends PageParams {
  active?: boolean
}

export interface PaymentListParams extends PageParams {
  status?: string
  invoice_id?: string
}

export interface InvoiceListParams extends PageParams {
  status?: string
  validation_status?: string
  vendor_id?: string
  department_id?: string
  requester_id?: string
  q?: string
}

export interface InboxListParams extends PageParams {
  classification?: InboxClassification
  status?: InboxStatus
  q?: string
}

export interface VendorListParams extends PageParams {
  status?: string
  category?: string
  q?: string
}

export interface AuditListParams extends PageParams {
  entity_type?: string
  entity_id?: string
  actor_id?: string
  action?: string
  from?: string
  to?: string
}

function buildQuery(params: object = {}): string {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }

  const query = search.toString()
  return query ? `?${query}` : ''
}

const ALL_PAGES_SIZE = 100
const MAX_PAGES = 20

/**
 * Follow the pagination envelope until every row is loaded (or a safety cap is
 * hit). The demo dataset has a few hundred rows per list; at 100x volume these
 * screens should move the filters to the server and page on demand.
 */
async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<PaginatedResponse<T>>
): Promise<PaginatedResponse<T>> {
  const first = await fetchPage(1)
  const results = [...first.results]
  let page = 1

  while (results.length < first.count && page < MAX_PAGES) {
    page += 1
    const next = await fetchPage(page)

    if (next.results.length === 0) break
    results.push(...next.results)
  }

  return {
    count: first.count,
    next: null,
    previous: null,
    results,
  }
}

// -------------------------------------
// AUTH
// -------------------------------------

export const authService = {
  login: (username: string, password: string) =>
    api.post<{ token: string; user: User }>('/auth/login/', {
      username,
      password,
    }),

  me: () => api.get<User>('/auth/me/'),

  logout: () => api.post<void>('/auth/logout/'),
}

// -------------------------------------
// INVOICES
// -------------------------------------

export const invoiceService = {
  list: (params: InvoiceListParams = {}) =>
    api.get<PaginatedResponse<Invoice>>(`/invoices/${buildQuery(params)}`),

  listAll: (params: InvoiceListParams = {}) =>
    fetchAllPages((page) =>
      invoiceService.list({ ...params, page, page_size: ALL_PAGES_SIZE })
    ),

  get: (id: string) =>
    api.get<Invoice>(`/invoices/${encodeURIComponent(id)}/`),

  trace: (id: string) =>
    api.get<InvoiceTrace>(
      `/invoices/${encodeURIComponent(id)}/audit/`
    ),

  upload: (file: File) => api.upload<Invoice>('/invoices/upload/', file),

  patch: (id: string, body: InvoicePatch) =>
    api.patch<Invoice>(`/invoices/${encodeURIComponent(id)}/`, body),

  analyze: (id: string) =>
    api.post<AnalysisResponse>(
      `/invoices/${encodeURIComponent(id)}/analyze/`
    ),

  submit: (id: string) =>
    api.post<Invoice>(`/invoices/${encodeURIComponent(id)}/submit/`),

  resolveFinding: (id: string, findingId: string, justification: string) =>
    api.post<Invoice>(
      `/invoices/${encodeURIComponent(id)}/resolve-finding/`,
      {
        finding_id: findingId,
        justification,
      }
    ),
}

// -------------------------------------
// AP INBOX
// -------------------------------------

export const inboxService = {
  list: (params: InboxListParams = {}) =>
    api.get<PaginatedResponse<InboxEmail>>(`/inbox/${buildQuery(params)}`),

  get: (id: string) =>
    api.get<InboxEmail>(`/inbox/${encodeURIComponent(id)}/`),

  sync: () => api.post<InboxSyncResult>('/inbox/sync/'),

  ingest: (id: string, attachmentFilename?: string) =>
    api.post<InboxIngestResult>(
      `/inbox/${encodeURIComponent(id)}/ingest/`,
      attachmentFilename ? { attachment: attachmentFilename } : {}
    ),

  dismiss: (id: string) =>
    api.post<void>(`/inbox/${encodeURIComponent(id)}/dismiss/`),
}

// -------------------------------------
// VENDORS
// -------------------------------------

export const vendorService = {
  list: (params: VendorListParams = {}) =>
    api.get<PaginatedResponse<VendorDetail>>(
      `/vendors/${buildQuery(params)}`
    ),

  listAll: (params: VendorListParams = {}) =>
    fetchAllPages((page) =>
      vendorService.list({ ...params, page, page_size: ALL_PAGES_SIZE })
    ),

  get: (id: string) =>
    api.get<VendorDetail>(`/vendors/${encodeURIComponent(id)}/`),

  bankChanges: (id: string) =>
    fetchAllPages((page) =>
      api.get<PaginatedResponse<BankChange>>(
        `/vendors/${encodeURIComponent(id)}/bank-changes/${buildQuery({
          page,
          page_size: ALL_PAGES_SIZE,
        })}`
      )
    ),

  create: (payload: VendorWritePayload) =>
    api.post<VendorDetail>('/vendors/', payload),

  update: (id: string, payload: VendorWritePayload) =>
    api.patch<VendorDetail>(
      `/vendors/${encodeURIComponent(id)}/`,
      payload
    ),

  approve: (id: string) =>
    api.post<VendorDetail>(
      `/vendors/${encodeURIComponent(id)}/approve/`
    ),

  hold: (id: string) =>
    api.post<VendorDetail>(`/vendors/${encodeURIComponent(id)}/hold/`),

  unhold: (id: string) =>
    api.post<VendorDetail>(
      `/vendors/${encodeURIComponent(id)}/unhold/`
    ),

  requestBankChange: (id: string, payload: BankChangeRequest) =>
    api.post<BankChange>(
      `/vendors/${encodeURIComponent(id)}/bank-changes/`,
      payload
    ),

  approveBankChange: (id: string, changeId: string) =>
    api.post<BankChange>(
      `/vendors/${encodeURIComponent(id)}/bank-changes/${encodeURIComponent(
        changeId
      )}/approve/`
    ),

  rejectBankChange: (id: string, changeId: string) =>
    api.post<BankChange>(
      `/vendors/${encodeURIComponent(id)}/bank-changes/${encodeURIComponent(
        changeId
      )}/reject/`
    ),
}

// -------------------------------------
// REFERENCE DATA
// -------------------------------------

export const referenceService = {
  glAccounts: () =>
    api.get<PaginatedResponse<GLAccount>>(
      `/gl-accounts/${buildQuery({
        account_type: 'expense',
        page_size: 100,
      })}`
    ),

  departments: () =>
    api.get<PaginatedResponse<Department>>(
      `/departments/${buildQuery({ page_size: 100 })}`
    ),
}

// -------------------------------------
// APPROVALS
// -------------------------------------

export const approvalService = {
  list: (params: ApprovalListParams = {}) =>
    api.get<PaginatedResponse<Approval>>(`/approvals/${buildQuery(params)}`),

  listAll: (params: ApprovalListParams = {}) =>
    fetchAllPages((page) =>
      approvalService.list({ ...params, page, page_size: ALL_PAGES_SIZE })
    ),

  get: (id: string) =>
    api.get<Approval>(`/approvals/${encodeURIComponent(id)}/`),

  approve: (id: string, comment: string) =>
    api.post<Invoice>(`/approvals/${encodeURIComponent(id)}/approve/`, {
      comment,
    }),

  reject: (id: string, comment: string) =>
    api.post<Invoice>(`/approvals/${encodeURIComponent(id)}/reject/`, {
      comment,
    }),
}

// -------------------------------------
// DELEGATIONS
// -------------------------------------

export const delegationService = {
  list: (params: PageParams = {}) =>
    api.get<PaginatedResponse<Delegation>>(
      `/delegations/${buildQuery(params)}`
    ),

  listAll: (params: PageParams = {}) =>
    fetchAllPages((page) =>
      delegationService.list({ ...params, page, page_size: ALL_PAGES_SIZE })
    ),

  get: (id: string) =>
    api.get<Delegation>(`/delegations/${encodeURIComponent(id)}/`),

  create: (payload: DelegationWritePayload) =>
    api.post<Delegation>('/delegations/', payload),

  /**
   * Ends an active delegation by setting `ends_at` on the server. History is
   * preserved; the row is not deleted. Scheduled delegations cannot be
   * cancelled through this endpoint yet, so the UI only offers it when active.
   */
  end: (id: string) =>
    api.delete<void>(`/delegations/${encodeURIComponent(id)}/`),
}

// -------------------------------------
// POLICY ADMINISTRATION
// -------------------------------------

export const policyService = {
  list: (params: PolicyListParams = {}) =>
    api.get<PaginatedResponse<Policy>>(`/policies/${buildQuery(params)}`),

  listAll: (params: PolicyListParams = {}) =>
    fetchAllPages((page) =>
      policyService.list({ ...params, page, page_size: ALL_PAGES_SIZE })
    ),

  get: (id: string) =>
    api.get<Policy>(`/policies/${encodeURIComponent(id)}/`),

  create: (payload: PolicyWritePayload) =>
    api.post<Policy>('/policies/', payload),

  update: (id: string, payload: Partial<PolicyWritePayload>) =>
    api.patch<Policy>(`/policies/${encodeURIComponent(id)}/`, payload),

  archive: (id: string) =>
    api.delete<void>(`/policies/${encodeURIComponent(id)}/`),
}

// -------------------------------------
// PAYMENTS
// -------------------------------------

export const paymentService = {
  list: (params: PaymentListParams = {}) =>
    api.get<PaginatedResponse<Payment>>(`/payments/${buildQuery(params)}`),

  listAll: (params: PaymentListParams = {}) =>
    fetchAllPages((page) =>
      paymentService.list({ ...params, page, page_size: ALL_PAGES_SIZE })
    ),

  get: (id: string) =>
    api.get<Payment>(`/payments/${encodeURIComponent(id)}/`),

  prepare: (invoiceId: string) =>
    api.post<Payment>('/payments/prepare/', {
      invoice_id: invoiceId,
    }),

  release: (id: string) =>
    api.post<Payment>(`/payments/${encodeURIComponent(id)}/release/`),

  cancel: (id: string) =>
    api.post<Payment>(`/payments/${encodeURIComponent(id)}/cancel/`),
}

// -------------------------------------
// AUDIT
// -------------------------------------

export const auditService = {
  list: (params: AuditListParams = {}) =>
    api.get<PaginatedResponse<AuditEvent>>(`/audit/${buildQuery(params)}`),

  exportCsv: (params: AuditListParams = {}) =>
    api.download(`/audit/export/${buildQuery(params)}`),
}

// -------------------------------------
// DASHBOARD
// -------------------------------------

export const dashboardService = {
  get: () => api.get<DashboardSummary>('/dashboard/'),
}
