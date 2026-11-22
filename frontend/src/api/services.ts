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
  suggested_gl_account?: string
  suggested_department_id?: string
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
