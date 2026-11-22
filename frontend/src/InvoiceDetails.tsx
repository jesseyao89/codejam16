import { useEffect, useState, type ReactNode } from 'react'

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  MenuItem,
  Snackbar,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'

import CloseIcon from '@mui/icons-material/Close'
import RefreshIcon from '@mui/icons-material/Refresh'
import SaveIcon from '@mui/icons-material/Save'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import SendIcon from '@mui/icons-material/Send'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import ErrorOutlineIcon from '@mui/icons-material/Error'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'

import {
  invoiceService,
  referenceService,
  type AuditEvent,
  type CodingSuggestion,
  type Department,
  type Finding,
  type GLAccount,
  type Invoice,
  type InvoiceLine,
  type InvoiceTrace,
  type User,
} from './api/services'

import { describeError, type ErrorPresentation } from './api/errors'

import {
  canEditInvoice,
  canEditInvoiceNow,
  canResolveFindings,
  canSubmitInvoice,
  canViewAudit,
} from './auth/permissions'

// --------------------------------------------------
// TYPES & HELPERS
// --------------------------------------------------

interface InvoiceDetailsProps {
  invoiceId: string | null
  user: User
  onClose: () => void
  onChanged: () => void | Promise<void>
}

interface LineEdit {
  gl_account: string
  department_id: string
}

function buildLineEdits(lines: InvoiceLine[] | undefined): Record<number, LineEdit> {
  const edits: Record<number, LineEdit> = {}

  for (const line of lines ?? []) {
    edits[line.line_no] = {
      gl_account: line.gl_account ?? '',
      department_id: line.department_id ?? '',
    }
  }

  return edits
}

function formatMoney(
  amount: string | null | undefined,
  currency: string | null
): string {
  if (amount === null || amount === undefined) return '—'
  return `${currency ?? ''} ${amount}`.trim()
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value

  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleDateString('en-CA', { dateStyle: 'medium' })
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatLabel(value: string): string {
  return value ? value.replace(/_/g, ' ') : '—'
}

function validationColor(
  status: string | null
): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'PASSED':
      return 'success'
    case 'WARNING':
      return 'warning'
    case 'BLOCKED':
      return 'error'
    default:
      return 'default'
  }
}

function invoiceStatusColor(
  status: string
): 'success' | 'warning' | 'error' | 'info' | 'default' {
  switch (status) {
    case 'PAID':
    case 'APPROVED':
      return 'success'
    case 'PENDING_APPROVAL':
    case 'REVIEW':
      return 'warning'
    case 'REJECTED':
      return 'error'
    case 'DRAFT':
      return 'info'
    default:
      return 'default'
  }
}

function DetailRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Stack direction="row" spacing={2} sx={{ py: 0.4 }}>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ minWidth: 145, flexShrink: 0 }}
      >
        {label}
      </Typography>

      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Stack>
  )
}

function evidenceText(value: Record<string, unknown> | null): string {
  if (!value || Object.keys(value).length === 0) return '—'
  return JSON.stringify(value)
}

// --------------------------------------------------
// COMPONENT
// --------------------------------------------------

export default function InvoiceDetails({
  invoiceId,
  user,
  onClose,
  onChanged,
}: InvoiceDetailsProps) {
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ErrorPresentation | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [activeTab, setActiveTab] = useState(0)

  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [refLoading, setRefLoading] = useState(true)
  const [refError, setRefError] = useState<ErrorPresentation | null>(null)

  const [lineEdits, setLineEdits] = useState<Record<number, LineEdit>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<ErrorPresentation | null>(null)

  const [action, setAction] = useState<'analyze' | 'submit' | null>(null)
  const [actionError, setActionError] =
    useState<ErrorPresentation | null>(null)

  const [notice, setNotice] = useState('')

  const [resolveTarget, setResolveTarget] = useState<Finding | null>(null)
  const [justification, setJustification] = useState('')
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] =
    useState<ErrorPresentation | null>(null)

  const [trace, setTrace] = useState<InvoiceTrace | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceError, setTraceError] =
    useState<ErrorPresentation | null>(null)
  const [traceReloadToken, setTraceReloadToken] = useState(0)

  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null)

  // --------------------------------------------------
  // LOAD INVOICE
  // --------------------------------------------------

  useEffect(() => {
    if (!invoiceId) return

    let cancelled = false

    invoiceService
      .get(invoiceId)
      .then((data) => {
        if (cancelled) return
        setInvoice(data)
        setLineEdits(buildLineEdits(data.lines))
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(describeError(err))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [invoiceId, reloadToken])

  // --------------------------------------------------
  // REFERENCE DATA
  // --------------------------------------------------

  useEffect(() => {
    let cancelled = false

    Promise.all([
      referenceService.glAccounts(),
      referenceService.departments(),
    ])
      .then(([glResponse, departmentResponse]) => {
        if (cancelled) return
        setGlAccounts(glResponse.results)
        setDepartments(departmentResponse.results)
        setRefLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setRefError(describeError(err))
        setRefLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // --------------------------------------------------
  // AUDIT TRACE (Controller / Auditor only)
  // --------------------------------------------------

  useEffect(() => {
    if (!invoiceId || activeTab !== 3 || !canViewAudit(user.role)) return

    let cancelled = false

    invoiceService
      .trace(invoiceId)
      .then((data) => {
        if (cancelled) return
        setTrace(data)
        setTraceLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setTraceError(describeError(err))
        setTraceLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [invoiceId, activeTab, traceReloadToken, user.role])

  // --------------------------------------------------
  // DERIVED
  // --------------------------------------------------

  const lines = invoice?.lines ?? []
  const suggestions = invoice?.coding_suggestions ?? []

  // One suggestion per line; unmatched lines carry a null GL account and a
  // reason asking for manual review. Keep them visible instead of dropping.
  const lineSuggestions = suggestions.filter(
    (suggestion) => typeof suggestion.line_no === 'number'
  )

  const confidentLineNumbers = new Set(
    lineSuggestions
      .filter((suggestion) => Boolean(suggestion.suggested_gl_account))
      .map((suggestion) => suggestion.line_no as number)
  )

  const manualReviewCount = lines.filter(
    (line) => !confidentLineNumbers.has(line.line_no)
  ).length

  const invoiceSuggestion = suggestions.find(
    (suggestion) => !suggestion.line_no && suggestion.account_number
  )

  const dirtyLines = lines.filter((line) => {
    const edit = lineEdits[line.line_no]
    if (!edit) return false

    return (
      edit.gl_account !== (line.gl_account ?? '') ||
      edit.department_id !== (line.department_id ?? '')
    )
  })

  const hasChanges = dirtyLines.length > 0

  const editable = invoice
    ? canEditInvoiceNow(user.role, invoice.status)
    : false

  const editRole = canEditInvoice(user.role)

  const openBlocks = (invoice?.findings ?? []).filter(
    (finding) => finding.severity === 'BLOCK' && finding.resolution === null
  )

  const openWarnings = (invoice?.findings ?? []).filter(
    (finding) => finding.severity === 'WARNING' && finding.resolution === null
  )

  const canSubmit =
    invoice !== null &&
    canSubmitInvoice(user.role, invoice.status) &&
    openBlocks.length === 0

  // --------------------------------------------------
  // ACTIONS
  // --------------------------------------------------

  function handleTabChange(value: number) {
    setActiveTab(value)

    if (value === 3 && canViewAudit(user.role)) {
      setTraceLoading(true)
      setTraceError(null)
      setTraceReloadToken((token) => token + 1)
    }
  }

  function handleRetry() {
    setLoading(true)
    setError(null)
    setReloadToken((token) => token + 1)
  }

  function updateLineEdit(lineNo: number, patch: Partial<LineEdit>) {
    setLineEdits((previous) => ({
      ...previous,
      [lineNo]: {
        gl_account: previous[lineNo]?.gl_account ?? '',
        department_id: previous[lineNo]?.department_id ?? '',
        ...patch,
      },
    }))
  }

  function applyLineSuggestion(
    lineNo: number,
    suggestion: CodingSuggestion
  ) {
    setLineEdits((previous) => ({
      ...previous,
      [lineNo]: {
        gl_account:
          suggestion.suggested_gl_account ??
          previous[lineNo]?.gl_account ??
          '',
        department_id:
          suggestion.suggested_department_id ??
          previous[lineNo]?.department_id ??
          '',
      },
    }))
  }

  function applyInvoiceSuggestion() {
    const account = invoiceSuggestion?.account_number
    if (!account) return

    setLineEdits((previous) => {
      const next: Record<number, LineEdit> = { ...previous }

      for (const line of lines) {
        next[line.line_no] = {
          gl_account: account,
          department_id: next[line.line_no]?.department_id ?? '',
        }
      }

      return next
    })
  }

  function resetChanges() {
    setLineEdits(buildLineEdits(invoice?.lines))
    setSaveError(null)
  }

  async function handleSave() {
    if (!invoice || dirtyLines.length === 0) return

    setSaving(true)
    setSaveError(null)

    try {
      await invoiceService.patch(invoice.id, {
        lines: dirtyLines.map((line) => {
          const edit = lineEdits[line.line_no]
          return {
            line_no: line.line_no,
            gl_account: edit.gl_account || null,
            department_id: edit.department_id || null,
          }
        }),
      })

      setNotice(
        `Saved coding for ${dirtyLines.length} line${
          dirtyLines.length === 1 ? '' : 's'
        }.`
      )
      setReloadToken((token) => token + 1)
      await onChanged()
    } catch (err) {
      setSaveError(describeError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleAnalyze() {
    if (!invoice) return

    setAction('analyze')
    setActionError(null)

    try {
      const result = await invoiceService.analyze(invoice.id)
      setNotice(`Analysis complete: ${result.validation_status}.`)
      setReloadToken((token) => token + 1)
      await onChanged()
    } catch (err) {
      setActionError(describeError(err))
    } finally {
      setAction(null)
    }
  }

  async function handleSubmit() {
    if (!invoice) return

    setAction('submit')
    setActionError(null)

    try {
      const submitted = await invoiceService.submit(invoice.id)
      setNotice(
        `Invoice ${submitted.id} submitted. ${
          submitted.approvals.length
        } approval step${
          submitted.approvals.length === 1 ? '' : 's'
        } routed.`
      )
      setReloadToken((token) => token + 1)
      await onChanged()
    } catch (err) {
      setActionError(describeError(err))
    } finally {
      setAction(null)
    }
  }

  function openResolve(finding: Finding) {
    setResolveTarget(finding)
    setJustification('')
    setResolveError(null)
  }

  async function handleResolve() {
    if (!invoice || !resolveTarget) return

    const trimmed = justification.trim()

    if (!trimmed) {
      setResolveError({
        code: 'VALIDATION_ERROR',
        message: 'A justification is required to resolve a warning.',
        hint: 'Record what you checked so the override is auditable.',
      })
      return
    }

    setResolving(true)
    setResolveError(null)

    try {
      await invoiceService.resolveFinding(
        invoice.id,
        resolveTarget.finding_id,
        trimmed
      )
      setNotice(`Finding ${resolveTarget.code} resolved.`)
      setResolveTarget(null)
      setReloadToken((token) => token + 1)
      await onChanged()
    } catch (err) {
      setResolveError(describeError(err))
    } finally {
      setResolving(false)
    }
  }

  function reloadTrace() {
    setTraceLoading(true)
    setTraceError(null)
    setTraceReloadToken((token) => token + 1)
  }

  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------

  return (
    <Drawer
      anchor="right"
      open={invoiceId !== null}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100%', sm: 780 },
            maxWidth: '100vw',
            backgroundColor: '#FFFFFF',
          },
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}
      >
        {/* HEADER */}
        <Box
          sx={{
            backgroundColor: '#404D73',
            color: '#FFFFFF',
            px: 4,
            py: 3,
          }}
        >
          <Stack
            direction="row"
            sx={{
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="overline"
                sx={{ color: '#DDE4F5', letterSpacing: 1.5 }}
              >
                BLUEBERI / INVOICE
              </Typography>

              <Typography
                variant="h5"
                sx={{ fontWeight: 700, mt: 1, overflowWrap: 'anywhere' }}
              >
                {invoice?.id ?? invoiceId ?? 'Invoice'}
              </Typography>

              <Typography sx={{ color: '#E0E5F0', mt: 0.5 }}>
                {invoice?.vendor?.legal_name ?? 'Loading vendor...'}
              </Typography>
            </Box>

            <IconButton
              onClick={onClose}
              sx={{ color: '#FFFFFF' }}
              aria-label="Close invoice details"
            >
              <CloseIcon />
            </IconButton>
          </Stack>
        </Box>

        {/* LOADING / ERROR */}
        {loading && !invoice && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              p: 4,
            }}
          >
            <CircularProgress size={22} />
            <Typography color="text.secondary">
              Loading invoice details...
            </Typography>
          </Box>
        )}

        {error && !invoice && (
          <Box sx={{ p: 4 }}>
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={handleRetry}>
                  Retry
                </Button>
              }
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Could not load invoice ({error.code})
              </Typography>

              <Typography variant="body2">{error.message}</Typography>

              {error.hint && (
                <Typography variant="caption">{error.hint}</Typography>
              )}
            </Alert>
          </Box>
        )}

        {invoice && (
          <>
            {/* STATUS STRIP */}
            <Box sx={{ px: 4, py: 2.5, backgroundColor: '#F8F9FC' }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                sx={{
                  justifyContent: 'space-between',
                  alignItems: { xs: 'flex-start', sm: 'center' },
                }}
              >
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                  <Chip
                    label={formatLabel(invoice.status)}
                    color={invoiceStatusColor(invoice.status)}
                    sx={{ fontWeight: 700 }}
                  />

                  <Chip
                    label={`Validation: ${
                      invoice.validation_status ?? 'Not analyzed'
                    }`}
                    variant="outlined"
                    color={validationColor(invoice.validation_status)}
                  />

                  {openBlocks.length > 0 && (
                    <Chip
                      icon={<ErrorOutlineIcon />}
                      label={`${openBlocks.length} blocking`}
                      color="error"
                      variant="outlined"
                    />
                  )}

                  {openWarnings.length > 0 && (
                    <Chip
                      icon={<WarningAmberIcon />}
                      label={`${openWarnings.length} warning${
                        openWarnings.length === 1 ? '' : 's'
                      }`}
                      color="warning"
                      variant="outlined"
                    />
                  )}
                </Stack>

                <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
                  <Typography
                    variant="caption"
                    sx={{ color: '#667085', fontWeight: 700 }}
                  >
                    TOTAL
                  </Typography>

                  <Typography
                    variant="h5"
                    sx={{ fontWeight: 800, color: '#263451' }}
                  >
                    {formatMoney(invoice.total, invoice.currency)}
                  </Typography>

                  {invoice.total_cad && (
                    <Typography variant="caption" color="text.secondary">
                      CAD {invoice.total_cad}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Box>

            {/* TABS */}
            <Tabs
              value={activeTab}
              onChange={(_event, value: number) => handleTabChange(value)}
              sx={{
                px: 3,
                borderBottom: '1px solid #E5E7EB',
                '& .MuiTab-root': {
                  textTransform: 'none',
                  fontWeight: 600,
                },
                '& .Mui-selected': { color: '#404D73 !important' },
                '& .MuiTabs-indicator': { backgroundColor: '#404D73' },
              }}
            >
              <Tab label="Overview" />
              <Tab label="Findings" />
              <Tab label="Approvals" />
              <Tab label="Activity" />
            </Tabs>

            {/* CONTENT */}
            <Box sx={{ flex: 1, overflowY: 'auto', px: 4, py: 3 }}>
              {/* OVERVIEW */}
              {activeTab === 0 && (
                <Stack spacing={3}>
                  {!editRole && (
                    <Alert severity="info">
                      Your role can view this invoice but not change it.
                      Coding and submission are limited to AP Clerks, Finance
                      Managers and Controllers.
                    </Alert>
                  )}

                  {editRole && !editable && (
                    <Alert severity="info">
                      Coding is locked while the invoice is{' '}
                      {formatLabel(invoice.status)}. Only DRAFT and REVIEW
                      invoices can be edited.
                    </Alert>
                  )}

                  <Box>
                    <Typography
                      sx={{ fontWeight: 700, color: '#263451', mb: 1.5 }}
                    >
                      Invoice details
                    </Typography>

                    <DetailRow label="Invoice number">
                      <Typography variant="body2">
                        {invoice.invoice_number ?? '—'}
                      </Typography>
                    </DetailRow>

                    <DetailRow label="Currency">
                      <Typography variant="body2">
                        {invoice.currency ?? '—'}
                      </Typography>
                    </DetailRow>

                    <DetailRow label="Invoice date">
                      <Typography variant="body2">
                        {formatDate(invoice.invoice_date)}
                      </Typography>
                    </DetailRow>

                    <DetailRow label="Due date">
                      <Typography variant="body2">
                        {formatDate(invoice.due_date)}
                      </Typography>
                    </DetailRow>

                    <DetailRow label="Ship-to province">
                      <Typography variant="body2">
                        {invoice.ship_to_province || '—'}
                      </Typography>
                    </DetailRow>

                    <DetailRow label="Department">
                      <Typography variant="body2">
                        {invoice.department
                          ? `${invoice.department.name} (${invoice.department.id})`
                          : 'Unassigned'}
                      </Typography>
                    </DetailRow>

                    <DetailRow label="Requested by">
                      <Typography variant="body2">
                        {invoice.requester_id ?? '—'}
                      </Typography>
                    </DetailRow>

                    <DetailRow label="Purchase order">
                      <Typography variant="body2">
                        {invoice.po_id ?? 'None'}
                      </Typography>
                    </DetailRow>

                    <DetailRow label="Contract">
                      <Typography variant="body2">
                        {invoice.contract_id ?? 'None'}
                      </Typography>
                    </DetailRow>
                  </Box>

                  <Divider />

                  {/* SUGGESTIONS */}
                  {invoiceSuggestion && (
                    <Alert
                      severity="info"
                      icon={<CheckCircleIcon />}
                      action={
                        editable ? (
                          <Button
                            color="inherit"
                            size="small"
                            onClick={applyInvoiceSuggestion}
                          >
                            Apply GL to all lines
                          </Button>
                        ) : undefined
                      }
                    >
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        Suggested coding:{' '}
                        {invoiceSuggestion.account_number}
                        {invoiceSuggestion.account_name
                          ? ` · ${invoiceSuggestion.account_name}`
                          : ''}
                      </Typography>

                      <Typography variant="body2">
                        {invoiceSuggestion.reason}
                      </Typography>

                      <Typography variant="caption" color="text.secondary">
                        Legacy invoice-level suggestion. Re-run analysis to
                        generate per-line suggestions.
                      </Typography>
                    </Alert>
                  )}

                  {refError && (
                    <Alert severity="warning">
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Coding pickers unavailable ({refError.code})
                      </Typography>

                      <Typography variant="body2">
                        {refError.message}
                      </Typography>
                    </Alert>
                  )}

                  {saveError && (
                    <Alert severity="error">
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Could not save coding ({saveError.code})
                      </Typography>

                      <Typography variant="body2">
                        {saveError.message}
                      </Typography>

                      {saveError.hint && (
                        <Typography variant="caption">
                          {saveError.hint}
                        </Typography>
                      )}
                    </Alert>
                  )}

                  <Box>
                    <Stack
                      direction="row"
                      sx={{
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        mb: 1.5,
                      }}
                    >
                      <Typography
                        sx={{ fontWeight: 700, color: '#263451' }}
                      >
                        Line items
                      </Typography>

                      {editable && hasChanges && (
                        <Button size="small" onClick={resetChanges}>
                          Reset unsaved changes
                        </Button>
                      )}
                    </Stack>

                    {lines.length > 0 && lineSuggestions.length > 0 && (
                      <Alert
                        severity={
                          manualReviewCount > 0 ? 'info' : 'success'
                        }
                        sx={{ mb: 1.5 }}
                      >
                        {confidentLineNumbers.size} of {lines.length} line
                        {lines.length === 1 ? '' : 's'} have a GL suggestion
                        {manualReviewCount > 0
                          ? `; ${manualReviewCount} need manual review.`
                          : '.'}
                      </Alert>
                    )}

                    {lines.length > 0 &&
                      lineSuggestions.length === 0 &&
                      suggestions.length === 0 && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', mb: 1.5 }}
                        >
                          No coding suggestions were produced. Choose GL
                          accounts manually, or run analysis again.
                        </Typography>
                      )}

                    {lines.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No line items were extracted. Correct the invoice data
                        and run analysis again.
                      </Typography>
                    ) : (
                      <TableContainer
                        sx={{ border: '1px solid #E5E7EB', borderRadius: 1 }}
                      >
                        <Table size="small">
                          <TableHead>
                            <TableRow sx={{ backgroundColor: '#EEF1F7' }}>
                              <TableCell sx={{ fontWeight: 700 }}>
                                Description
                              </TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>
                                Qty
                              </TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>
                                Unit price
                              </TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>
                                Amount
                              </TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>
                                GL account
                              </TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>
                                Department
                              </TableCell>
                            </TableRow>
                          </TableHead>

                          <TableBody>
                            {lines.map((line) => {
                              const edit = lineEdits[line.line_no] ?? {
                                gl_account: line.gl_account ?? '',
                                department_id: line.department_id ?? '',
                              }

                              const suggestion = lineSuggestions.find(
                                (item) => item.line_no === line.line_no
                              )

                              return (
                                <TableRow key={line.line_no} hover>
                                  <TableCell sx={{ minWidth: 220 }}>
                                    <Typography
                                      variant="body2"
                                      sx={{ fontWeight: 600 }}
                                    >
                                      {line.description}
                                    </Typography>

                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                    >
                                      Line {line.line_no}
                                      {line.line_type
                                        ? ` · ${line.line_type}`
                                        : ''}
                                    </Typography>

                                    {lineSuggestions.length > 0 && (
                                      <Box sx={{ mt: 0.5 }}>
                                        {suggestion ? (
                                          <>
                                            {suggestion.suggested_gl_account ? (
                                              <Typography
                                                variant="caption"
                                                sx={{
                                                  display: 'block',
                                                  color: '#404D73',
                                                  fontWeight: 600,
                                                }}
                                              >
                                                Suggested{' '}
                                                {
                                                  suggestion.suggested_gl_account
                                                }
                                                {suggestion.suggested_department_id
                                                  ? ` / ${suggestion.suggested_department_id}`
                                                  : ''}
                                                {suggestion.confidence
                                                  ? ` · confidence ${suggestion.confidence}`
                                                  : ''}
                                              </Typography>
                                            ) : (
                                              <Typography
                                                variant="caption"
                                                sx={{
                                                  display: 'block',
                                                  color: '#B86B00',
                                                  fontWeight: 600,
                                                }}
                                              >
                                                No confident GL suggestion
                                                {suggestion.suggested_department_id
                                                  ? ` (department ${suggestion.suggested_department_id})`
                                                  : ''}{' '}
                                                — review this line manually.
                                              </Typography>
                                            )}

                                            {suggestion.reason && (
                                              <Typography
                                                variant="caption"
                                                color="text.secondary"
                                                sx={{ display: 'block' }}
                                              >
                                                {suggestion.reason}
                                              </Typography>
                                            )}

                                            {editable &&
                                              (suggestion.suggested_gl_account ||
                                                suggestion.suggested_department_id) && (
                                                <Button
                                                  size="small"
                                                  onClick={() =>
                                                    applyLineSuggestion(
                                                      line.line_no,
                                                      suggestion
                                                    )
                                                  }
                                                >
                                                  {suggestion.suggested_gl_account
                                                    ? 'Apply suggestion'
                                                    : 'Apply department'}
                                                </Button>
                                              )}
                                          </>
                                        ) : (
                                          <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            sx={{ display: 'block' }}
                                          >
                                            No suggestion for this line; choose
                                            a GL account manually.
                                          </Typography>
                                        )}
                                      </Box>
                                    )}
                                  </TableCell>

                                  <TableCell>{line.quantity}</TableCell>

                                  <TableCell>{line.unit_price}</TableCell>

                                  <TableCell sx={{ fontWeight: 600 }}>
                                    {line.amount}
                                  </TableCell>

                                  <TableCell>
                                    <TextField
                                      select
                                      size="small"
                                      value={edit.gl_account}
                                      disabled={!editable || refLoading}
                                      onChange={(event) =>
                                        updateLineEdit(line.line_no, {
                                          gl_account: event.target.value,
                                        })
                                      }
                                      sx={{ minWidth: 190 }}
                                    >
                                      <MenuItem value="">Uncoded</MenuItem>

                                      {edit.gl_account &&
                                        !glAccounts.some(
                                          (account) =>
                                            account.account_number ===
                                            edit.gl_account
                                        ) && (
                                          <MenuItem value={edit.gl_account}>
                                            {edit.gl_account} (unknown)
                                          </MenuItem>
                                        )}

                                      {glAccounts.map((account) => (
                                        <MenuItem
                                          key={account.account_number}
                                          value={account.account_number}
                                        >
                                          {account.account_number} ·{' '}
                                          {account.name}
                                        </MenuItem>
                                      ))}
                                    </TextField>
                                  </TableCell>

                                  <TableCell>
                                    <TextField
                                      select
                                      size="small"
                                      value={edit.department_id}
                                      disabled={!editable || refLoading}
                                      onChange={(event) =>
                                        updateLineEdit(line.line_no, {
                                          department_id:
                                            event.target.value,
                                        })
                                      }
                                      sx={{ minWidth: 160 }}
                                    >
                                      <MenuItem value="">
                                        Unassigned
                                      </MenuItem>

                                      {edit.department_id &&
                                        !departments.some(
                                          (department) =>
                                            department.id ===
                                            edit.department_id
                                        ) && (
                                          <MenuItem
                                            value={edit.department_id}
                                          >
                                            {edit.department_id} (unknown)
                                          </MenuItem>
                                        )}

                                      {departments.map((department) => (
                                        <MenuItem
                                          key={department.id}
                                          value={department.id}
                                        >
                                          {department.id} · {department.name}
                                        </MenuItem>
                                      ))}
                                    </TextField>
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </Box>

                  {/* TOTALS */}
                  <Box>
                    <Stack
                      direction="row"
                      sx={{ justifyContent: 'space-between', py: 0.4 }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        Subtotal
                      </Typography>
                      <Typography variant="body2">
                        {formatMoney(invoice.subtotal, invoice.currency)}
                      </Typography>
                    </Stack>

                    {(invoice.tax_lines ?? []).map((tax) => (
                      <Stack
                        key={tax.tax_code}
                        direction="row"
                        sx={{ justifyContent: 'space-between', py: 0.4 }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          {tax.tax_code}
                          {tax.rate ? ` (${tax.rate})` : ''}
                        </Typography>
                        <Typography variant="body2">
                          {formatMoney(tax.amount, invoice.currency)}
                        </Typography>
                      </Stack>
                    ))}

                    <Stack
                      direction="row"
                      sx={{ justifyContent: 'space-between', py: 0.4 }}
                    >
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 700 }}
                      >
                        Total
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {formatMoney(invoice.total, invoice.currency)}
                      </Typography>
                    </Stack>

                    <Stack
                      direction="row"
                      sx={{ justifyContent: 'space-between', py: 0.4 }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        FX to CAD
                      </Typography>
                      <Typography variant="body2">
                        {invoice.fx_rate_to_cad ?? '—'}
                        {invoice.fx_rate_date
                          ? ` (${invoice.fx_rate_date})`
                          : ''}
                      </Typography>
                    </Stack>

                    <Stack
                      direction="row"
                      sx={{ justifyContent: 'space-between', py: 0.4 }}
                    >
                      <Typography
                        variant="body2"
                        color="text.secondary"
                      >
                        Total (CAD)
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {invoice.total_cad
                          ? `CAD ${invoice.total_cad}`
                          : '—'}
                      </Typography>
                    </Stack>
                  </Box>

                  {actionError && (
                    <Alert severity="error">
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Action failed ({actionError.code})
                      </Typography>

                      <Typography variant="body2">
                        {actionError.message}
                      </Typography>

                      {actionError.hint && (
                        <Typography variant="caption">
                          {actionError.hint}
                        </Typography>
                      )}
                    </Alert>
                  )}

                  {openBlocks.length > 0 && (
                    <Alert severity="warning" icon={<LockOutlinedIcon />}>
                      {openBlocks.length} blocking finding
                      {openBlocks.length === 1 ? '' : 's'} must be corrected
                      before this invoice can be submitted. BLOCK findings
                      cannot be overridden.
                    </Alert>
                  )}
                </Stack>
              )}

              {/* FINDINGS */}
              {activeTab === 1 && (
                <Stack spacing={2}>
                  <Typography
                    sx={{ fontWeight: 700, color: '#263451' }}
                  >
                    Validation findings
                  </Typography>

                  {(invoice.findings ?? []).length === 0 ? (
                    <Alert severity="success">
                      No findings recorded. The checks that ran found nothing —
                      this does not prove that skipped checks passed.
                    </Alert>
                  ) : (
                    invoice.findings.map((finding) => (
                      <Box
                        key={finding.finding_id}
                        sx={{
                          border: '1px solid #E5E7EB',
                          borderLeft:
                            finding.severity === 'BLOCK'
                              ? '5px solid #B42318'
                              : '5px solid #B86B00',
                          borderRadius: 1,
                          p: 2,
                        }}
                      >
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            mb: 1,
                          }}
                        >
                          <Chip
                            size="small"
                            label={finding.severity}
                            color={
                              finding.severity === 'BLOCK'
                                ? 'error'
                                : 'warning'
                            }
                            sx={{ fontWeight: 700 }}
                          />

                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 700 }}
                          >
                            {finding.code}
                          </Typography>

                          {finding.resolution ? (
                            <Chip
                              size="small"
                              label="Resolved"
                              color="success"
                              variant="outlined"
                            />
                          ) : (
                            <Chip
                              size="small"
                              label="Open"
                              variant="outlined"
                            />
                          )}
                        </Stack>

                        <Typography variant="body2" sx={{ mb: 1 }}>
                          {finding.message}
                        </Typography>

                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', overflowWrap: 'anywhere' }}
                        >
                          Evidence: {evidenceText(finding.evidence)}
                        </Typography>

                        {finding.resolution && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', mt: 0.5 }}
                          >
                            Resolved by {finding.resolution.resolved_by_id} on{' '}
                            {formatDateTime(finding.resolution.resolved_at)} —{' '}
                            {finding.resolution.justification}
                          </Typography>
                        )}

                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ mt: 1.5, alignItems: 'center' }}
                        >
                          {finding.severity === 'BLOCK' ? (
                            <Typography
                              variant="caption"
                              color="error.main"
                            >
                              Blocking findings cannot be overridden. Correct
                              the invoice data and re-run analysis.
                            </Typography>
                          ) : (
                            !finding.resolution &&
                            canResolveFindings(
                              user.role,
                              invoice.status
                            ) && (
                              <Button
                                size="small"
                                variant="outlined"
                                color="warning"
                                onClick={() => openResolve(finding)}
                              >
                                Resolve warning
                              </Button>
                            )
                          )}
                        </Stack>
                      </Box>
                    ))
                  )}
                </Stack>
              )}

              {/* APPROVALS */}
              {activeTab === 2 && (
                <Stack spacing={2}>
                  <Typography
                    sx={{ fontWeight: 700, color: '#263451' }}
                  >
                    Approval chain
                  </Typography>

                  {invoice.approvals.length === 0 ? (
                    <Alert severity="info">
                      No approval steps yet. Submit the invoice to route the
                      policy-driven approval chain.
                    </Alert>
                  ) : (
                    <TableContainer
                      sx={{ border: '1px solid #E5E7EB', borderRadius: 1 }}
                    >
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={{ backgroundColor: '#EEF1F7' }}>
                            <TableCell sx={{ fontWeight: 700 }}>
                              Step
                            </TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>
                              Approver
                            </TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>
                              Status
                            </TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>
                              Reason
                            </TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>
                              Comment
                            </TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>
                              Acted
                            </TableCell>
                          </TableRow>
                        </TableHead>

                        <TableBody>
                          {invoice.approvals.map((step) => (
                            <TableRow key={step.id}>
                              <TableCell>{step.step_no}</TableCell>

                              <TableCell>
                                {step.approver
                                  ? step.approver.full_name
                                  : 'Unassigned'}
                                {step.delegated_for_id
                                  ? ` (for ${step.delegated_for_id})`
                                  : ''}
                              </TableCell>

                              <TableCell>
                                <Chip
                                  size="small"
                                  label={step.status}
                                  color={
                                    step.status === 'APPROVED'
                                      ? 'success'
                                      : step.status === 'REJECTED'
                                        ? 'error'
                                        : 'warning'
                                  }
                                />
                              </TableCell>

                              <TableCell>{step.reason}</TableCell>

                              <TableCell>{step.comment || '—'}</TableCell>

                              <TableCell>
                                {formatDateTime(step.acted_at)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}

                  <Typography variant="caption" color="text.secondary">
                    Decisions are made on the Approvals page so comments and
                    separation of duties are handled in one place.
                  </Typography>
                </Stack>
              )}

              {/* ACTIVITY */}
              {activeTab === 3 && (
                <Stack spacing={3}>
                  {!canViewAudit(user.role) ? (
                    <Alert severity="info" icon={<LockOutlinedIcon />}>
                      The audit-ready invoice trace is available to Controller
                      and Auditor roles. Approval history is on the Approvals
                      tab.
                    </Alert>
                  ) : traceLoading && !trace ? (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                      }}
                    >
                      <CircularProgress size={20} />
                      <Typography color="text.secondary">
                        Loading audit trace...
                      </Typography>
                    </Box>
                  ) : traceError && !trace ? (
                    <Alert
                      severity="error"
                      action={
                        <Button
                          color="inherit"
                          size="small"
                          onClick={reloadTrace}
                        >
                          Retry
                        </Button>
                      }
                    >
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Could not load the audit trace ({traceError.code})
                      </Typography>

                      <Typography variant="body2">
                        {traceError.message}
                      </Typography>
                    </Alert>
                  ) : trace ? (
                    <>
                      <Box>
                        <Stack
                          direction="row"
                          sx={{
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            mb: 1,
                          }}
                        >
                          <Typography
                            sx={{ fontWeight: 700, color: '#263451' }}
                          >
                            Audit events
                          </Typography>

                          <Button
                            size="small"
                            startIcon={<RefreshIcon />}
                            onClick={reloadTrace}
                          >
                            Refresh
                          </Button>
                        </Stack>

                        {trace.events.length === 0 ? (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                          >
                            No audit events recorded.
                          </Typography>
                        ) : (
                          <TableContainer
                            sx={{
                              border: '1px solid #E5E7EB',
                              borderRadius: 1,
                            }}
                          >
                            <Table size="small">
                              <TableHead>
                                <TableRow
                                  sx={{ backgroundColor: '#EEF1F7' }}
                                >
                                  <TableCell sx={{ fontWeight: 700 }}>
                                    Time
                                  </TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>
                                    Actor
                                  </TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>
                                    Action
                                  </TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>
                                    Entity
                                  </TableCell>
                                  <TableCell align="right" />
                                </TableRow>
                              </TableHead>

                              <TableBody>
                                {trace.events.map((event) => (
                                  <TableRow key={event.id} hover>
                                    <TableCell>
                                      {formatDateTime(event.timestamp)}
                                    </TableCell>

                                    <TableCell>
                                      {event.actor_name ??
                                        event.actor_id ??
                                        '—'}
                                      {event.on_behalf_of_id
                                        ? ` (for ${event.on_behalf_of_id})`
                                        : ''}
                                    </TableCell>

                                    <TableCell>
                                      {formatLabel(event.action)}
                                    </TableCell>

                                    <TableCell>
                                      {event.entity_type} ·{' '}
                                      {event.entity_id}
                                    </TableCell>

                                    <TableCell align="right">
                                      <Button
                                        size="small"
                                        onClick={() =>
                                          setSelectedEvent(event)
                                        }
                                      >
                                        Details
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        )}
                      </Box>

                      <Box>
                        <Typography
                          sx={{ fontWeight: 700, color: '#263451', mb: 1 }}
                        >
                          Coding history
                        </Typography>

                        {trace.coding_history.length === 0 ? (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                          >
                            No coding changes recorded.
                          </Typography>
                        ) : (
                          <TableContainer
                            sx={{
                              border: '1px solid #E5E7EB',
                              borderRadius: 1,
                            }}
                          >
                            <Table size="small">
                              <TableHead>
                                <TableRow
                                  sx={{ backgroundColor: '#EEF1F7' }}
                                >
                                  <TableCell sx={{ fontWeight: 700 }}>
                                    Line
                                  </TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>
                                    GL account
                                  </TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>
                                    Department
                                  </TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>
                                    Source
                                  </TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>
                                    Changed
                                  </TableCell>
                                </TableRow>
                              </TableHead>

                              <TableBody>
                                {trace.coding_history.map((entry, index) => (
                                  <TableRow
                                    key={`${entry.line_no}-${index}`}
                                  >
                                    <TableCell>{entry.line_no}</TableCell>
                                    <TableCell>
                                      {entry.gl_account ?? '—'}
                                    </TableCell>
                                    <TableCell>
                                      {entry.department_id ?? '—'}
                                    </TableCell>
                                    <TableCell>
                                      {formatLabel(entry.source)}
                                    </TableCell>
                                    <TableCell>
                                      {entry.changed_by_id ?? '—'} ·{' '}
                                      {formatDateTime(entry.changed_at)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        )}
                      </Box>

                      <Box>
                        <Typography
                          sx={{ fontWeight: 700, color: '#263451', mb: 1 }}
                        >
                          Payments
                        </Typography>

                        {trace.payments.length === 0 ? (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                          >
                            No payments linked to this invoice.
                          </Typography>
                        ) : (
                          <TableContainer
                            sx={{
                              border: '1px solid #E5E7EB',
                              borderRadius: 1,
                            }}
                          >
                            <Table size="small">
                              <TableHead>
                                <TableRow
                                  sx={{ backgroundColor: '#EEF1F7' }}
                                >
                                  <TableCell sx={{ fontWeight: 700 }}>
                                    Payment
                                  </TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>
                                    Status
                                  </TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>
                                    Amount
                                  </TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>
                                    CAD
                                  </TableCell>
                                  <TableCell sx={{ fontWeight: 700 }}>
                                    Paid
                                  </TableCell>
                                </TableRow>
                              </TableHead>

                              <TableBody>
                                {trace.payments.map((payment) => (
                                  <TableRow key={payment.id}>
                                    <TableCell>{payment.id}</TableCell>
                                    <TableCell>
                                      {formatLabel(payment.status)}
                                    </TableCell>
                                    <TableCell>
                                      {formatMoney(
                                        payment.amount,
                                        payment.currency
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      {payment.amount_cad
                                        ? `CAD ${payment.amount_cad}`
                                        : '—'}
                                    </TableCell>
                                    <TableCell>
                                      {formatDate(payment.paid_date)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        )}
                      </Box>
                    </>
                  ) : null}
                </Stack>
              )}
            </Box>

            {/* FOOTER */}
            <Box
              sx={{
                px: 4,
                py: 2,
                borderTop: '1px solid #E5E7EB',
                backgroundColor: '#FFFFFF',
              }}
            >
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}
              >
                <Button
                  onClick={onClose}
                  sx={{ color: '#404D73' }}
                >
                  Close
                </Button>

                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={handleRetry}
                  disabled={loading}
                >
                  Refresh
                </Button>

                {editRole && (
                  <>
                    <Button
                      variant="outlined"
                      startIcon={<PlayArrowIcon />}
                      disabled={!editable || action !== null}
                      onClick={() => {
                        void handleAnalyze()
                      }}
                    >
                      {action === 'analyze' ? 'Analyzing...' : 'Run analysis'}
                    </Button>

                    <Button
                      variant="outlined"
                      startIcon={<SaveIcon />}
                      disabled={!editable || !hasChanges || saving}
                      onClick={() => {
                        void handleSave()
                      }}
                    >
                      {saving
                        ? 'Saving...'
                        : hasChanges
                          ? `Save coding (${dirtyLines.length})`
                          : 'Save coding'}
                    </Button>

                    <Button
                      variant="contained"
                      startIcon={<SendIcon />}
                      disabled={!canSubmit || action !== null}
                      onClick={() => {
                        void handleSubmit()
                      }}
                      sx={{
                        backgroundColor: '#404D73',
                        '&:hover': { backgroundColor: '#354263' },
                      }}
                    >
                      {action === 'submit'
                        ? 'Submitting...'
                        : 'Submit for approval'}
                    </Button>
                  </>
                )}
              </Stack>
            </Box>
          </>
        )}
      </Box>

      {/* RESOLVE WARNING DIALOG */}
      <Dialog
        open={resolveTarget !== null}
        onClose={() => {
          if (!resolving) setResolveTarget(null)
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
          Resolve warning
        </DialogTitle>

        <DialogContent dividers>
          {resolveTarget && (
            <>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', mb: 1 }}
              >
                <WarningAmberIcon sx={{ color: '#B86B00' }} />

                <Typography sx={{ fontWeight: 700 }}>
                  {resolveTarget.code}
                </Typography>
              </Stack>

              <Typography variant="body2" sx={{ mb: 2 }}>
                {resolveTarget.message}
              </Typography>

              {resolveError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {resolveError.code}
                  </Typography>

                  <Typography variant="body2">
                    {resolveError.message}
                  </Typography>

                  {resolveError.hint && (
                    <Typography variant="caption">
                      {resolveError.hint}
                    </Typography>
                  )}
                </Alert>
              )}

              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Justification"
                required
                value={justification}
                disabled={resolving}
                onChange={(event) => setJustification(event.target.value)}
                helperText="Stored on the finding and in the audit trail."
              />
            </>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2.5 }}>
          <Button
            onClick={() => setResolveTarget(null)}
            disabled={resolving}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            disabled={resolving || !justification.trim()}
            onClick={() => {
              void handleResolve()
            }}
            sx={{
              backgroundColor: '#404D73',
              '&:hover': { backgroundColor: '#354263' },
            }}
          >
            {resolving ? 'Resolving...' : 'Resolve warning'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* EVENT DETAILS DIALOG */}
      <Dialog
        open={selectedEvent !== null}
        onClose={() => setSelectedEvent(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
          {selectedEvent
            ? `${formatLabel(selectedEvent.action)} · ${selectedEvent.id}`
            : 'Audit event'}
        </DialogTitle>

        <DialogContent dividers>
          {selectedEvent && (
            <Stack spacing={2}>
              <DetailRow label="Timestamp">
                <Typography variant="body2">
                  {formatDateTime(selectedEvent.timestamp)}
                </Typography>
              </DetailRow>

              <DetailRow label="Actor">
                <Typography variant="body2">
                  {selectedEvent.actor_name ?? '—'} (
                  {selectedEvent.actor_id ?? '—'})
                </Typography>
              </DetailRow>

              <DetailRow label="Entity">
                <Typography variant="body2">
                  {selectedEvent.entity_type} · {selectedEvent.entity_id}
                </Typography>
              </DetailRow>

              <Box>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: '#667085' }}
                >
                  BEFORE
                </Typography>

                <Typography
                  component="pre"
                  variant="caption"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    m: 0,
                    p: 1.5,
                    backgroundColor: '#F4F6FA',
                    borderRadius: 1,
                  }}
                >
                  {evidenceText(selectedEvent.before)}
                </Typography>
              </Box>

              <Box>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: '#667085' }}
                >
                  AFTER
                </Typography>

                <Typography
                  component="pre"
                  variant="caption"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    m: 0,
                    p: 1.5,
                    backgroundColor: '#F4F6FA',
                    borderRadius: 1,
                  }}
                >
                  {evidenceText(selectedEvent.after)}
                </Typography>
              </Box>

              <Box>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: '#667085' }}
                >
                  EVIDENCE
                </Typography>

                <Typography
                  component="pre"
                  variant="caption"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    m: 0,
                    p: 1.5,
                    backgroundColor: '#F4F6FA',
                    borderRadius: 1,
                  }}
                >
                  {evidenceText(selectedEvent.evidence)}
                </Typography>
              </Box>
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setSelectedEvent(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={5000}
        onClose={() => setNotice('')}
        message={notice}
      />
    </Drawer>
  )
}
