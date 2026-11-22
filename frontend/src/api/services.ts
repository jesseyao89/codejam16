// frontend/src/api/services.ts

import { api, type PaginatedResponse } from './client'

// -------------------------------------
// TYPES
// -------------------------------------

export interface User {
  id: string
  username: string
  full_name: string
  role: string
  email: string
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

export interface Invoice {
  id: string
  status: string
  vendor: Vendor | null
  invoice_number: string | null
  invoice_date: string | null
  due_date: string | null
  currency: string | null
  total: string | null
  total_cad: string | null
  validation_status: 'PASSED' | 'WARNING' | 'BLOCKED'
  findings: Finding[]
  approvals: Approval[]
}

export interface Approval {
  id: string
  invoice_id: string
  step_no: number
  status: string
  approver: {
    id: string
    full_name: string
    role: string
  }
  reason: string
}

export interface Payment {
  id: string
  invoice_id: string
  status: string
  amount: string
  currency: string
}

export interface DashboardSummary {
  role: string
  counts: {
    pending_my_approval: number
    in_review: number
    payments_due: number
    open_findings: number
  }
  pending_approvals: Approval[]
  payments_due: Payment[]
  recent_activity: unknown[]
}

// -------------------------------------
// AUTH
// -------------------------------------

export const authService = {
  login: (username: string, password: string) =>
    api.post<{ token: string; user: User }>(
      '/auth/login/',
      { username, password }
    ),

  me: () =>
    api.get<User>('/auth/me/'),

  logout: () =>
    api.post<void>('/auth/logout/'),
}

// -------------------------------------
// INVOICES
// -------------------------------------

export const invoiceService = {
  list: () =>
    api.get<PaginatedResponse<Invoice>>('/invoices/'),

  get: (id: string) =>
    api.get<Invoice>(`/invoices/${encodeURIComponent(id)}/`),

  upload: (file: File) =>
    api.upload<Invoice>('/invoices/upload/', file),

  analyze: (id: string) =>
    api.post<unknown>(
      `/invoices/${encodeURIComponent(id)}/analyze/`
    ),

  submit: (id: string) =>
    api.post<Invoice>(
      `/invoices/${encodeURIComponent(id)}/submit/`
    ),

  resolveFinding: (
    id: string,
    findingId: string,
    justification: string
  ) =>
    api.post<Invoice>(
      `/invoices/${encodeURIComponent(id)}/resolve-finding/`,
      {
        finding_id: findingId,
        justification,
      }
    ),
}

// -------------------------------------
// APPROVALS
// -------------------------------------

export const approvalService = {
  list: () =>
    api.get<PaginatedResponse<Approval>>('/approvals/'),

  approve: (id: string, comment: string) =>
    api.post<Invoice>(
      `/approvals/${encodeURIComponent(id)}/approve/`,
      { comment }
    ),

  reject: (id: string, comment: string) =>
    api.post<Invoice>(
      `/approvals/${encodeURIComponent(id)}/reject/`,
      { comment }
    ),
}

// -------------------------------------
// PAYMENTS
// -------------------------------------

export const paymentService = {
  list: () =>
    api.get<PaginatedResponse<Payment>>('/payments/'),

  prepare: (invoiceId: string) =>
    api.post<Payment>('/payments/prepare/', {
      invoice_id: invoiceId,
    }),

  release: (id: string) =>
    api.post<Payment>(
      `/payments/${encodeURIComponent(id)}/release/`
    ),
}

// -------------------------------------
// DASHBOARD
// -------------------------------------

export const dashboardService = {
  get: () =>
    api.get<DashboardSummary>('/dashboard/'),
}
