import { useCallback, useEffect, useState, type ReactNode } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'

import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import RefreshIcon from '@mui/icons-material/Refresh'

import {
  approvalService,
  invoiceService,
  type Approval,
  type ApprovalStatus,
  type Invoice,
  type User,
} from './api/services'

import { describeError, type ErrorPresentation } from './api/errors'
import { canDecideApproval } from './auth/permissions'

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

type Scope = 'mine' | 'all'
type StatusFilter = 'ALL' | ApprovalStatus

function approvalColor(
  status: ApprovalStatus
): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'APPROVED':
      return 'success'
    case 'REJECTED':
      return 'error'
    case 'PENDING':
      return 'warning'
    default:
      return 'default'
  }
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

function formatRole(role: string): string {
  return role
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatMoney(
  amount: string | null,
  currency: string | null
): string {
  if (amount === null) return '—'
  return `${currency ?? ''} ${amount}`.trim()
}

function formatValidation(status: string | null): string {
  return status ? status.replace(/_/g, ' ') : 'Not analyzed'
}

function DetailRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Stack direction="row" spacing={2} sx={{ py: 0.5 }}>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ minWidth: 150, flexShrink: 0 }}
      >
        {label}
      </Typography>

      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Stack>
  )
}

// --------------------------------------------------
// PAGE
// --------------------------------------------------

interface ApprovalsProps {
  user: User
  onDataChanged: () => void | Promise<void>
}

export default function Approvals({
  user,
  onDataChanged,
}: ApprovalsProps) {
  const [scope, setScope] = useState<Scope>('mine')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')

  const [approvals, setApprovals] = useState<Approval[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ErrorPresentation | null>(null)

  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)

  const [selected, setSelected] = useState<Approval | null>(null)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [invoiceError, setInvoiceError] =
    useState<ErrorPresentation | null>(null)
  const [invoiceReloadToken, setInvoiceReloadToken] = useState(0)

  const [comment, setComment] = useState('')
  const [actionLoading, setActionLoading] =
    useState<'approve' | 'reject' | null>(null)
  const [actionError, setActionError] =
    useState<ErrorPresentation | null>(null)

  const [notice, setNotice] = useState('')

  // --------------------------------------------------
  // LOAD
  // --------------------------------------------------

  const loadApprovals = useCallback(async () => {
    setLoading(true)
    setError(null)

    // "Pending + assigned to me" is the actionable queue. The dedicated
    // `actionable=true` filter already means assigned + PENDING + invoice
    // PENDING_APPROVAL (contract §7), so it replaces mine=true&status=PENDING.
    const actionable = scope === 'mine' && statusFilter === 'PENDING'

    try {
      const response = await approvalService.listAll({
        actionable: actionable ? true : undefined,
        mine: actionable
          ? undefined
          : scope === 'mine'
            ? true
            : undefined,
        status: actionable
          ? undefined
          : statusFilter === 'ALL'
            ? undefined
            : statusFilter,
      })

      setApprovals(response.results)
      setTotal(response.count)
    } catch (err) {
      setError(describeError(err))
      setApprovals([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [scope, statusFilter])

  useEffect(() => {
    async function load() {
      await loadApprovals()
    }

    void load()
  }, [loadApprovals])

  // Load the full invoice when a step is opened. The approval payload only
  // carries `invoice_id`; the decision screen needs the invoice, its findings
  // and the whole approval chain.
  useEffect(() => {
    if (!selected) return

    let cancelled = false

    invoiceService
      .get(selected.invoice_id)
      .then((data) => {
        if (cancelled) return
        setInvoice(data)
        setInvoiceLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setInvoiceError(describeError(err))
        setInvoiceLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selected, invoiceReloadToken])

  // --------------------------------------------------
  // DERIVED
  // --------------------------------------------------

  const pendingCount = approvals.filter(
    (approval) => approval.status === 'PENDING'
  ).length

  const approvedCount = approvals.filter(
    (approval) => approval.status === 'APPROVED'
  ).length

  const rejectedCount = approvals.filter(
    (approval) => approval.status === 'REJECTED'
  ).length

  const visibleApprovals = approvals.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  )

  const canDecideRole = canDecideApproval(user.role)
  const isRequester = invoice?.requester_id === user.id
  const canDecide = canDecideRole && !isRequester

  // --------------------------------------------------
  // ACTIONS
  // --------------------------------------------------

  function openReview(approval: Approval) {
    setComment('')
    setActionError(null)
    setInvoice(null)
    setInvoiceError(null)
    setInvoiceLoading(true)
    setSelected(approval)
  }

  function closeDialog() {
    if (actionLoading) return
    setSelected(null)
    setComment('')
    setActionError(null)
    setInvoice(null)
    setInvoiceError(null)
    setInvoiceLoading(false)
  }

  async function handleDecision(decision: 'approve' | 'reject') {
    if (!selected) return

    const trimmedComment = comment.trim()

    if (decision === 'reject' && !trimmedComment) {
      setActionError({
        code: 'VALIDATION_ERROR',
        message: 'A comment is required to reject an invoice.',
        hint: 'Tell the requester what needs to change before resubmission.',
      })
      return
    }

    setActionLoading(decision)
    setActionError(null)

    try {
      const updated =
        decision === 'approve'
          ? await approvalService.approve(selected.id, trimmedComment)
          : await approvalService.reject(selected.id, trimmedComment)

      if (decision === 'approve') {
        setNotice(
          updated.status === 'APPROVED'
            ? `Invoice ${updated.id} approved. All approval steps are complete.`
            : `Invoice ${updated.id} approved. It is waiting for the next approver.`
        )
      } else {
        setNotice(
          `Invoice ${updated.id} rejected and returned to REVIEW.`
        )
      }

      setSelected(null)
      setComment('')

      await loadApprovals()
      await onDataChanged()
    } catch (err) {
      setActionError(describeError(err))
    } finally {
      setActionLoading(null)
    }
  }

  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------

  return (
    <Box>
      {/* HEADER / FILTERS */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{
              justifyContent: 'space-between',
              alignItems: { xs: 'flex-start', md: 'center' },
            }}
          >
            <Box>
              <Typography
                variant="h6"
                sx={{ fontWeight: 700, color: '#263451' }}
              >
                Approval Queue
              </Typography>

              <Typography variant="body2" color="text.secondary">
                Sequential, policy-routed steps. Decisions are recorded in the
                audit trail.
              </Typography>
            </Box>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}
            >
              <ToggleButtonGroup
                size="small"
                exclusive
                value={scope}
                onChange={(_event, value: Scope | null) => {
                  if (!value) return
                  setScope(value)
                  setPage(0)
                }}
              >
                <ToggleButton value="mine">Assigned to me</ToggleButton>
                <ToggleButton value="all">All visible</ToggleButton>
              </ToggleButtonGroup>

              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>Status</InputLabel>

                <Select
                  label="Status"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as StatusFilter)
                    setPage(0)
                  }}
                >
                  <MenuItem value="ALL">All statuses</MenuItem>
                  <MenuItem value="PENDING">Pending</MenuItem>
                  <MenuItem value="APPROVED">Approved</MenuItem>
                  <MenuItem value="REJECTED">Rejected</MenuItem>
                </Select>
              </FormControl>

              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                disabled={loading}
                onClick={() => {
                  void loadApprovals()
                }}
              >
                Refresh
              </Button>
            </Stack>
          </Stack>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 2 }}
          >
            {scope === 'mine' && statusFilter === 'PENDING'
              ? 'Steps assigned to you that need a decision now.'
              : scope === 'mine'
                ? 'Steps assigned to you, your active delegate, or your role.'
                : 'Every approval step visible to your role.'}{' '}
            {total} step{total === 1 ? '' : 's'} in this view.
          </Typography>
        </CardContent>
      </Card>

      {/* SUMMARY */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={3}
        sx={{ mb: 3 }}
      >
        {[
          {
            label: 'Pending',
            value: pendingCount,
            color: '#B86B00',
            icon: <AccessTimeIcon />,
          },
          {
            label: 'Approved',
            value: approvedCount,
            color: '#166534',
            icon: <CheckCircleIcon />,
          },
          {
            label: 'Rejected',
            value: rejectedCount,
            color: '#B42318',
            icon: <CancelIcon />,
          },
        ].map((item) => (
          <Card key={item.label} sx={{ flex: 1 }}>
            <CardContent sx={{ p: 3 }}>
              <Stack
                direction="row"
                sx={{
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  {item.label}
                </Typography>

                <Box sx={{ color: item.color }}>{item.icon}</Box>
              </Stack>

              <Typography
                variant="h4"
                sx={{ fontWeight: 800, color: item.color, mt: 1 }}
              >
                {item.value}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {/* ERROR */}
      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                void loadApprovals()
              }}
            >
              Retry
            </Button>
          }
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Could not load approvals ({error.code})
          </Typography>

          <Typography variant="body2">{error.message}</Typography>

          {error.hint && (
            <Typography variant="caption">{error.hint}</Typography>
          )}
        </Alert>
      )}

      {/* QUEUE */}
      <Card>
        {loading ? (
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
              Loading approval steps...
            </Typography>
          </Box>
        ) : approvals.length === 0 ? (
          <Box sx={{ p: 4 }}>
            <Typography sx={{ fontWeight: 600, color: '#263451' }}>
              {error
                ? 'Approvals could not be loaded.'
                : 'No approval steps match this view.'}
            </Typography>

            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {error
                ? 'Use Retry above to try again.'
                : statusFilter === 'PENDING'
                  ? 'Nothing is waiting for a decision. Submit an invoice from the Invoices page to route an approval chain.'
                  : 'Approval steps appear here once an invoice is submitted and routed.'}
            </Typography>
          </Box>
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <TableHead sx={{ backgroundColor: '#E9EDF5' }}>
                  <TableRow>
                    <TableCell>Invoice</TableCell>
                    <TableCell>Step</TableCell>
                    <TableCell>Approver</TableCell>
                    <TableCell>Routing reason</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Acted</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {visibleApprovals.map((approval) => (
                    <TableRow key={approval.id} hover>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 600 }}
                        >
                          {approval.invoice_id}
                        </Typography>
                      </TableCell>

                      <TableCell>{approval.step_no}</TableCell>

                      <TableCell>
                        {approval.approver ? (
                          <>
                            <Typography variant="body2">
                              {approval.approver.full_name}
                            </Typography>

                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {formatRole(approval.approver.role)}
                            </Typography>
                          </>
                        ) : (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                          >
                            Unassigned
                          </Typography>
                        )}

                        {approval.delegated_for_id && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`Delegated for ${approval.delegated_for_id}`}
                            sx={{ ml: 1 }}
                          />
                        )}
                      </TableCell>

                      <TableCell>
                        <Typography variant="body2">
                          {approval.reason}
                        </Typography>
                      </TableCell>

                      <TableCell>
                        <Chip
                          size="small"
                          label={approval.status}
                          color={approvalColor(approval.status)}
                          sx={{ fontWeight: 600 }}
                        />
                      </TableCell>

                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {formatDateTime(approval.acted_at)}
                        </Typography>
                      </TableCell>

                      <TableCell align="right">
                        <Button
                          size="small"
                          variant={
                            approval.status === 'PENDING'
                              ? 'contained'
                              : 'outlined'
                          }
                          sx={
                            approval.status === 'PENDING'
                              ? {
                                  backgroundColor: '#404D73',
                                  '&:hover': {
                                    backgroundColor: '#354263',
                                  },
                                }
                              : undefined
                          }
                          onClick={() => openReview(approval)}
                        >
                          {approval.status === 'PENDING'
                            ? 'Review & decide'
                            : 'View'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <TablePagination
              component="div"
              count={approvals.length}
              page={page}
              rowsPerPage={rowsPerPage}
              rowsPerPageOptions={[10, 25, 50]}
              onPageChange={(_event, newPage) => setPage(newPage)}
              onRowsPerPageChange={(event) => {
                setRowsPerPage(Number(event.target.value))
                setPage(0)
              }}
            />
          </>
        )}
      </Card>

      {/* DECISION DIALOG */}
      <Dialog
        open={selected !== null}
        onClose={closeDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
          {selected
            ? `Invoice ${selected.invoice_id} — step ${selected.step_no}`
            : 'Approval'}
        </DialogTitle>

        <DialogContent dividers>
          {invoiceLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
              <CircularProgress size={20} />

              <Typography color="text.secondary">
                Loading invoice details...
              </Typography>
            </Box>
          )}

          {invoiceError && (
            <Alert
              severity="warning"
              sx={{ mb: 2 }}
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => {
                    setInvoiceError(null)
                    setInvoiceLoading(true)
                    setInvoiceReloadToken((token) => token + 1)
                  }}
                >
                  Retry
                </Button>
              }
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Invoice details unavailable ({invoiceError.code})
              </Typography>

              <Typography variant="body2">{invoiceError.message}</Typography>
            </Alert>
          )}

          {invoice && (
            <Box sx={{ mb: 3 }}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', mb: 2, flexWrap: 'wrap' }}
              >
                <Chip
                  size="small"
                  label={invoice.status.replace(/_/g, ' ')}
                  color={invoiceStatusColor(invoice.status)}
                  sx={{ fontWeight: 600 }}
                />

                <Chip
                  size="small"
                  variant="outlined"
                  label={`Validation: ${formatValidation(
                    invoice.validation_status
                  )}`}
                  color={validationColor(invoice.validation_status)}
                />
              </Stack>

              <DetailRow label="Vendor">
                <Typography variant="body2">
                  {invoice.vendor?.legal_name ?? 'Unknown vendor'}
                  {invoice.vendor?.status
                    ? ` (${invoice.vendor.status})`
                    : ''}
                </Typography>
              </DetailRow>

              <DetailRow label="Invoice number">
                <Typography variant="body2">
                  {invoice.invoice_number ?? '—'}
                </Typography>
              </DetailRow>

              <DetailRow label="Amount">
                <Typography variant="body2">
                  {formatMoney(invoice.total, invoice.currency)}
                  {invoice.total_cad
                    ? ` · CAD ${invoice.total_cad}`
                    : ''}
                </Typography>
              </DetailRow>

              <DetailRow label="Dates">
                <Typography variant="body2">
                  Invoice {invoice.invoice_date ?? '—'} · Due{' '}
                  {invoice.due_date ?? '—'}
                </Typography>
              </DetailRow>

              <DetailRow label="Department">
                <Typography variant="body2">
                  {invoice.department
                    ? `${invoice.department.name} (${invoice.department.id})`
                    : '—'}
                </Typography>
              </DetailRow>

              <DetailRow label="Requested by">
                <Typography variant="body2">
                  {invoice.requester_id ?? '—'}
                </Typography>
              </DetailRow>

              {invoice.po_id && (
                <DetailRow label="Purchase order">
                  <Typography variant="body2">{invoice.po_id}</Typography>
                </DetailRow>
              )}
            </Box>
          )}

          {/* FINDINGS */}
          {invoice && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Findings
              </Typography>

              {invoice.findings.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No findings recorded.
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {invoice.findings.map((finding) => (
                    <Box
                      key={finding.finding_id}
                      sx={{
                        border: '1px solid #E5E7EB',
                        borderRadius: 1,
                        p: 1.5,
                      }}
                    >
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', mb: 0.5 }}
                      >
                        <Chip
                          size="small"
                          label={finding.severity}
                          color={
                            finding.severity === 'BLOCK'
                              ? 'error'
                              : 'warning'
                          }
                        />

                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 600 }}
                        >
                          {finding.code}
                        </Typography>

                        {finding.resolution && (
                          <Chip
                            size="small"
                            variant="outlined"
                            color="success"
                            label="Resolved"
                          />
                        )}
                      </Stack>

                      <Typography variant="body2">
                        {finding.message}
                      </Typography>

                      {finding.resolution && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          {finding.resolution.justification} —{' '}
                          {finding.resolution.resolved_by_id},{' '}
                          {formatDateTime(finding.resolution.resolved_at)}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>
          )}

          {/* CHAIN */}
          {invoice && invoice.approvals.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Approval chain
              </Typography>

              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Step</TableCell>
                      <TableCell>Approver</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Reason</TableCell>
                      <TableCell>Comment</TableCell>
                      <TableCell>Acted</TableCell>
                    </TableRow>
                  </TableHead>

                  <TableBody>
                    {invoice.approvals.map((step) => (
                      <TableRow
                        key={step.id}
                        selected={step.id === selected?.id}
                        hover
                      >
                        <TableCell>{step.step_no}</TableCell>

                        <TableCell>
                          {step.approver?.full_name ?? 'Unassigned'}
                        </TableCell>

                        <TableCell>
                          <Chip
                            size="small"
                            label={step.status}
                            color={approvalColor(step.status)}
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
            </Box>
          )}

          {/* STEP ACTIONS */}
          {selected && (
            <Box>
              <Divider sx={{ mb: 2 }} />

              {selected.status !== 'PENDING' ? (
                <Alert severity="info">
                  This step was already {selected.status.toLowerCase()}
                  {selected.acted_at
                    ? ` on ${formatDateTime(selected.acted_at)}`
                    : ''}
                  . No further action is possible.
                </Alert>
              ) : isRequester ? (
                <Alert severity="warning">
                  You requested this invoice, so you cannot decide it
                  (SELF_APPROVAL_BLOCKED). It must be approved by your manager.
                </Alert>
              ) : !canDecideRole ? (
                <Alert severity="info">
                  Your role ({formatRole(user.role)}) cannot approve or reject
                  invoices. Only Approvers and Finance Managers can decide.
                </Alert>
              ) : (
                <>
                  {selected.approver &&
                    selected.approver.id !== user.id && (
                      <Alert severity="info" sx={{ mb: 2 }}>
                        This step is assigned to {selected.approver.full_name}.
                        If you are not that approver or their active delegate,
                        the server will refuse the decision.
                      </Alert>
                    )}

                  {actionError && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {actionError.code}
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

                  <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    label={
                      selected.status === 'PENDING'
                        ? 'Comment (required to reject)'
                        : 'Comment'
                    }
                    value={comment}
                    disabled={actionLoading !== null}
                    onChange={(event) => setComment(event.target.value)}
                    helperText="The comment is stored on the approval step and in the audit evidence."
                  />
                </>
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={closeDialog} disabled={actionLoading !== null}>
            Close
          </Button>

          {selected &&
            selected.status === 'PENDING' &&
            canDecide && (
              <>
                <Button
                  variant="outlined"
                  color="error"
                  disabled={
                    actionLoading !== null || invoiceLoading || !invoice
                  }
                  onClick={() => {
                    void handleDecision('reject')
                  }}
                >
                  {actionLoading === 'reject' ? 'Rejecting...' : 'Reject'}
                </Button>

                <Button
                  variant="contained"
                  disabled={
                    actionLoading !== null || invoiceLoading || !invoice
                  }
                  onClick={() => {
                    void handleDecision('approve')
                  }}
                  sx={{
                    backgroundColor: '#2E7D4F',
                    '&:hover': { backgroundColor: '#24643F' },
                  }}
                >
                  {actionLoading === 'approve' ? 'Approving...' : 'Approve'}
                </Button>
              </>
            )}
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={5000}
        onClose={() => setNotice('')}
        message={notice}
      />
    </Box>
  )
}
