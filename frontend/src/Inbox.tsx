import { useCallback, useEffect, useRef, useState } from 'react'

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
  Typography,
} from '@mui/material'

import RefreshIcon from '@mui/icons-material/Refresh'
import SyncIcon from '@mui/icons-material/Sync'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import AttachFileIcon from '@mui/icons-material/AttachFile'

import {
  inboxService,
  type InboxClassification,
  type InboxEmail,
  type InboxStatus,
  type User,
} from './api/services'

import { describeError, type ErrorPresentation } from './api/errors'

import { canManageInbox, canReadInbox } from './auth/permissions'

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

type ClassificationFilter = 'ALL' | InboxClassification
type StatusFilter = 'ALL' | InboxStatus

type PendingAction =
  | { kind: 'sync' }
  | { kind: 'dismiss'; email: InboxEmail }
  | { kind: 'ingest'; email: InboxEmail; attachment?: string }

interface InboxSummary {
  total: number
  invoice: number
  notInvoice: number
  uncertain: number
}

function classificationColor(
  classification: InboxClassification
): 'success' | 'warning' | 'default' {
  switch (classification) {
    case 'INVOICE':
      return 'success'
    case 'UNCERTAIN':
      return 'warning'
    default:
      return 'default'
  }
}

function statusColor(
  status: InboxStatus
): 'success' | 'warning' | 'info' | 'default' {
  switch (status) {
    case 'INGESTED':
      return 'success'
    case 'PARTIAL':
      return 'warning'
    case 'NEW':
      return 'info'
    default:
      return 'default'
  }
}

function attachmentColor(
  status: string
): 'success' | 'error' | 'info' | 'default' {
  switch (status) {
    case 'INGESTED':
      return 'success'
    case 'FAILED':
      return 'error'
    case 'NEW':
      return 'info'
    default:
      return 'default'
  }
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

// --------------------------------------------------
// PAGE
// --------------------------------------------------

interface InboxProps {
  user: User
  onDataChanged: () => void | Promise<void>
  onOpenInvoice: (invoiceId: string) => void
}

export default function Inbox({
  user,
  onDataChanged,
  onOpenInvoice,
}: InboxProps) {
  const readAllowed = canReadInbox(user.role)
  const manageAllowed = canManageInbox(user.role)

  const [emails, setEmails] = useState<InboxEmail[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ErrorPresentation | null>(null)

  const [classificationFilter, setClassificationFilter] =
    useState<ClassificationFilter>('ALL')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')

  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)

  const listRequestRef = useRef(0)
  const summaryRequestRef = useRef(0)
  const searchTimerRef = useRef<number | null>(null)

  const [summary, setSummary] = useState<InboxSummary | null>(null)
  const [summaryError, setSummaryError] =
    useState<ErrorPresentation | null>(null)

  const [detailEmail, setDetailEmail] = useState<InboxEmail | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null
  )
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] =
    useState<ErrorPresentation | null>(null)

  const [notice, setNotice] = useState('')

  // --------------------------------------------------
  // LOAD
  // --------------------------------------------------

  const loadEmails = useCallback(async () => {
    if (!readAllowed) return

    const requestId = ++listRequestRef.current

    setLoading(true)
    setError(null)

    try {
      const response = await inboxService.list({
        classification:
          classificationFilter === 'ALL'
            ? undefined
            : classificationFilter,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        q: appliedQuery.trim() || undefined,
        page: page + 1,
        page_size: rowsPerPage,
      })

      if (requestId !== listRequestRef.current) return

      setEmails(response.results)
      setCount(response.count)
    } catch (err) {
      if (requestId !== listRequestRef.current) return

      const presentation = describeError(err)

      // A filter/action can shrink the result set below the current page.
      // Recover to the first page instead of getting stuck on a 404.
      if (presentation.code === 'NOT_FOUND' && page > 0) {
        setPage(0)
        return
      }

      setError(presentation)
      setEmails([])
      setCount(0)
    } finally {
      if (requestId === listRequestRef.current) {
        setLoading(false)
      }
    }
  }, [
    readAllowed,
    classificationFilter,
    statusFilter,
    appliedQuery,
    page,
    rowsPerPage,
  ])

  useEffect(() => {
    async function load() {
      await loadEmails()
    }

    void load()

    return () => {
      // Ignore a response from a query/page that is no longer current.
      listRequestRef.current += 1
    }
  }, [loadEmails])

  const loadSummary = useCallback(async () => {
    if (!readAllowed) return

    const requestId = ++summaryRequestRef.current

    try {
      const [all, invoice, notInvoice, uncertain] = await Promise.all([
        inboxService.list({ page_size: 1 }),
        inboxService.list({ classification: 'INVOICE', page_size: 1 }),
        inboxService.list({ classification: 'NOT_INVOICE', page_size: 1 }),
        inboxService.list({ classification: 'UNCERTAIN', page_size: 1 }),
      ])

      if (requestId !== summaryRequestRef.current) return

      setSummaryError(null)
      setSummary({
        total: all.count,
        invoice: invoice.count,
        notInvoice: notInvoice.count,
        uncertain: uncertain.count,
      })
    } catch (err) {
      if (requestId !== summaryRequestRef.current) return
      setSummaryError(describeError(err))
    }
  }, [readAllowed])

  useEffect(() => {
    async function load() {
      await loadSummary()
    }

    void load()
  }, [loadSummary])

  useEffect(() => {
    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current)
      }
      summaryRequestRef.current += 1
    }
  }, [])

  // --------------------------------------------------
  // DERIVED
  // --------------------------------------------------

  function hasUnprocessedAttachment(email: InboxEmail): boolean {
    return email.attachments.some((attachment) => !attachment.invoice_id)
  }

  function canIngest(email: InboxEmail): boolean {
    return (
      manageAllowed &&
      email.classification !== 'NOT_INVOICE' &&
      email.status !== 'DISMISSED' &&
      hasUnprocessedAttachment(email)
    )
  }

  function canDismiss(email: InboxEmail): boolean {
    return manageAllowed && email.status !== 'DISMISSED'
  }

  function openInvoice(invoiceId: string) {
    setDetailEmail(null)
    onOpenInvoice(invoiceId)
  }

  // --------------------------------------------------
  // ACTIONS
  // --------------------------------------------------

  function handleSearchChange(value: string) {
    setQuery(value)

    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current)
    }

    searchTimerRef.current = window.setTimeout(() => {
      setAppliedQuery(value)
      setPage(0)
    }, 300)
  }

  function requestSync() {
    setActionError(null)
    setPendingAction({ kind: 'sync' })
  }

  function requestIngest(email: InboxEmail, attachment?: string) {
    setActionError(null)
    setDetailEmail(null)
    setPendingAction({ kind: 'ingest', email, attachment })
  }

  function requestDismiss(email: InboxEmail) {
    setActionError(null)
    setDetailEmail(null)
    setPendingAction({ kind: 'dismiss', email })
  }

  async function refreshAll() {
    await loadEmails()
    await loadSummary()
    await onDataChanged()
  }

  async function handleConfirm() {
    if (!pendingAction) return

    setActionLoading(true)
    setActionError(null)

    try {
      if (pendingAction.kind === 'sync') {
        const result = await inboxService.sync()

        setNotice(
          `Sync complete: ${result.ingested} ingested, ${
            result.skipped
          } skipped, ${result.routed} routed${
            result.failed ? `, ${result.failed} failed` : ''
          }.`
        )
        setDetailEmail(null)
      } else if (pendingAction.kind === 'dismiss') {
        await inboxService.dismiss(pendingAction.email.id)
        setNotice(`Email ${pendingAction.email.id} dismissed.`)
      } else {
        const previousIds = new Set(pendingAction.email.invoice_ids)
        const result = await inboxService.ingest(
          pendingAction.email.id,
          pendingAction.attachment
        )

        const created = result.invoices
          .filter((invoice) => !previousIds.has(invoice.id))
          .map((invoice) => invoice.id)

        setNotice(
          created.length > 0
            ? `Ingested ${created.length} new invoice${
                created.length === 1 ? '' : 's'
              }: ${created.join(', ')}.`
            : 'No new invoices were created; the selected attachments were already ingested.'
        )
      }

      setPendingAction(null)
      await refreshAll()
    } catch (err) {
      setActionError(describeError(err))
    } finally {
      setActionLoading(false)
    }
  }

  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------

  if (!readAllowed) {
    return (
      <Alert severity="info" icon={<LockOutlinedIcon />}>
        The AP inbox is available to AP Clerk, Finance Manager, Controller and
        Auditor roles.
      </Alert>
    )
  }

  const actionTitle =
    pendingAction?.kind === 'sync'
      ? 'Sync AP inbox'
      : pendingAction?.kind === 'dismiss'
        ? 'Dismiss email'
        : 'Ingest attachments'

  return (
    <Box>
      {/* HEADER */}
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
                AP Inbox
              </Typography>

              <Typography variant="body2" color="text.secondary">
                Supplier email classification and attachment intake. One draft
                invoice is created per attachment.
              </Typography>
            </Box>

            <Stack direction="row" spacing={2}>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                disabled={loading}
                onClick={() => {
                  void loadEmails()
                  void loadSummary()
                }}
              >
                Refresh
              </Button>

              {manageAllowed && (
                <Button
                  variant="contained"
                  startIcon={<SyncIcon />}
                  onClick={requestSync}
                  sx={{
                    backgroundColor: '#404D73',
                    '&:hover': { backgroundColor: '#354263' },
                  }}
                >
                  Sync inbox
                </Button>
              )}
            </Stack>
          </Stack>

          {!manageAllowed && (
            <Alert severity="info" icon={<LockOutlinedIcon />} sx={{ mt: 2 }}>
              Your role can read the inbox but cannot sync, ingest or dismiss
              emails.
            </Alert>
          )}
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
            label: 'Invoice emails',
            value: summary?.invoice,
            color: '#166534',
          },
          {
            label: 'Uncertain',
            value: summary?.uncertain,
            color: '#B86B00',
          },
          {
            label: 'Not invoices',
            value: summary?.notInvoice,
            color: '#667085',
          },
          {
            label: 'Total emails',
            value: summary?.total,
            color: '#263451',
          },
        ].map((item) => (
          <Card key={item.label} sx={{ flex: 1 }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="body2" color="text.secondary">
                {item.label}
              </Typography>

              <Typography
                variant="h4"
                sx={{ fontWeight: 800, color: item.color, mt: 1 }}
              >
                {item.value ?? '—'}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {summaryError && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mb: 2 }}
        >
          Inbox totals unavailable ({summaryError.code}). The list below still
          works.
        </Typography>
      )}

      {/* FILTERS */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2.5 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ alignItems: { xs: 'stretch', md: 'center' } }}
          >
            <TextField
              size="small"
              fullWidth
              label="Search"
              placeholder="Subject or sender"
              value={query}
              onChange={(event) => {
                handleSearchChange(event.target.value)
              }}
            />

            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel>Classification</InputLabel>

              <Select
                label="Classification"
                value={classificationFilter}
                onChange={(event) => {
                  setClassificationFilter(
                    event.target.value as ClassificationFilter
                  )
                  setPage(0)
                }}
              >
                <MenuItem value="ALL">All classifications</MenuItem>
                <MenuItem value="INVOICE">Invoice</MenuItem>
                <MenuItem value="NOT_INVOICE">Not an invoice</MenuItem>
                <MenuItem value="UNCERTAIN">Uncertain</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 150 }}>
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
                <MenuItem value="NEW">New</MenuItem>
                <MenuItem value="PARTIAL">Partial</MenuItem>
                <MenuItem value="INGESTED">Ingested</MenuItem>
                <MenuItem value="ROUTED">Routed</MenuItem>
                <MenuItem value="DISMISSED">Dismissed</MenuItem>
              </Select>
            </FormControl>

            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {count} email{count === 1 ? '' : 's'}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

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
                void loadEmails()
              }}
            >
              Retry
            </Button>
          }
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Could not load the AP inbox ({error.code})
          </Typography>

          <Typography variant="body2">{error.message}</Typography>

          {error.hint && (
            <Typography variant="caption">{error.hint}</Typography>
          )}
        </Alert>
      )}

      {/* TABLE */}
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
              Loading AP inbox...
            </Typography>
          </Box>
        ) : (
          <>
            {emails.length === 0 ? (
              !error && (
                <Box sx={{ p: 4 }}>
                  <Typography sx={{ fontWeight: 600, color: '#263451' }}>
                    No emails match this view.
                  </Typography>

                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 1 }}
                  >
                    {manageAllowed
                      ? 'Clear the filters, or sync the inbox to load the AP mailbox.'
                      : 'Clear the filters to find another email.'}
                  </Typography>
                </Box>
              )
            ) : (
              <TableContainer>
              <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 960 }}>
                <TableHead sx={{ backgroundColor: '#E9EDF5' }}>
                  <TableRow>
                    <TableCell sx={{ width: '8%' }}>Received</TableCell>
                    <TableCell sx={{ width: '9%' }}>From</TableCell>
                    <TableCell sx={{ width: '23%' }}>Subject</TableCell>
                    <TableCell sx={{ width: '12%' }}>
                      Classification
                    </TableCell>
                    <TableCell sx={{ width: '10%' }}>Status</TableCell>
                    <TableCell sx={{ width: '24%' }}>
                      Files / Invoices
                    </TableCell>
                    <TableCell align="right" sx={{ width: '14%' }}>
                      Actions
                    </TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {emails.map((email) => (
                    <TableRow key={email.id} hover>
                      <TableCell sx={{ whiteSpace: 'normal' }}>
                        {formatDateTime(email.received_at)}
                      </TableCell>

                      <TableCell sx={{ overflowWrap: 'anywhere' }}>
                        <Typography variant="body2">
                          {email.from_name || email.sender || '—'}
                        </Typography>

                        <Typography
                          variant="caption"
                          color="text.secondary"
                        >
                          {email.sender}
                        </Typography>
                      </TableCell>

                      <TableCell
                        sx={{
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{ overflowWrap: 'anywhere' }}
                        >
                          {email.subject || '(no subject)'}
                        </Typography>
                      </TableCell>

                      <TableCell>
                        <Chip
                          size="small"
                          label={email.classification.replace(/_/g, ' ')}
                          color={classificationColor(email.classification)}
                          sx={{ fontWeight: 600 }}
                        />

                        {email.classification_confidence && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', mt: 0.5 }}
                          >
                            {email.classification_confidence}
                          </Typography>
                        )}
                      </TableCell>

                      <TableCell>
                        <Chip
                          size="small"
                          label={email.status}
                          color={statusColor(email.status)}
                        />
                      </TableCell>

                      <TableCell>
                        <Stack spacing={0.75}>
                          {email.attachments.length === 0 ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              No attachments
                            </Typography>
                          ) : (
                            email.attachments.map((attachment) => (
                              <Stack
                                key={`${attachment.filename}-${attachment.order}`}
                                direction="row"
                                spacing={0.5}
                                sx={{
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  rowGap: 0.5,
                                }}
                              >
                                <AttachFileIcon
                                  sx={{ fontSize: 14, color: '#667085' }}
                                />

                                <Typography
                                  variant="caption"
                                  sx={{
                                    flex: 1,
                                    minWidth: 0,
                                    overflowWrap: 'anywhere',
                                    wordBreak: 'break-word',
                                  }}
                                >
                                  {attachment.filename}
                                </Typography>

                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label={attachment.status}
                                  color={attachmentColor(
                                    attachment.status
                                  )}
                                />
                              </Stack>
                            ))
                          )}

                          {email.invoice_ids.length > 0 && (
                            <Box>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block' }}
                              >
                                Invoices
                              </Typography>

                              <Stack
                                direction="row"
                                spacing={0.5}
                                sx={{ flexWrap: 'wrap', rowGap: 0.5 }}
                              >
                                {email.invoice_ids.map((invoiceId) => (
                                  <Button
                                    key={invoiceId}
                                    size="small"
                                    sx={{
                                      textTransform: 'none',
                                      p: 0,
                                      minWidth: 0,
                                      justifyContent: 'flex-start',
                                    }}
                                    onClick={() => openInvoice(invoiceId)}
                                  >
                                    {invoiceId}
                                  </Button>
                                ))}
                              </Stack>
                            </Box>
                          )}
                        </Stack>
                      </TableCell>

                      <TableCell align="right">
                        <Stack
                          direction="row"
                          spacing={0.5}
                          sx={{
                            justifyContent: 'flex-end',
                            flexWrap: 'wrap',
                            rowGap: 0.5,
                          }}
                        >
                          <Button
                            size="small"
                            onClick={() => setDetailEmail(email)}
                          >
                            View
                          </Button>

                          {canIngest(email) && (
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => requestIngest(email)}
                              sx={{
                                backgroundColor: '#404D73',
                                '&:hover': {
                                  backgroundColor: '#354263',
                                },
                              }}
                            >
                              Ingest
                            </Button>
                          )}

                          {canDismiss(email) && (
                            <Button
                              size="small"
                              color="inherit"
                              onClick={() => requestDismiss(email)}
                            >
                              Dismiss
                            </Button>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </TableContainer>
            )}

            {count > 0 && (
              <TablePagination
                component="div"
                count={count}
                page={page}
                rowsPerPage={rowsPerPage}
                rowsPerPageOptions={[10, 25, 50]}
                onPageChange={(_event, newPage) => setPage(newPage)}
                onRowsPerPageChange={(event) => {
                  setRowsPerPage(Number(event.target.value))
                  setPage(0)
                }}
              />
            )}
          </>
        )}
      </Card>

      {/* EMAIL DETAIL */}
      <Dialog
        open={detailEmail !== null}
        onClose={() => setDetailEmail(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
          {detailEmail ? detailEmail.subject || detailEmail.id : 'Email'}
        </DialogTitle>

        <DialogContent dividers>
          {detailEmail && (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Chip
                  size="small"
                  label={detailEmail.classification.replace(/_/g, ' ')}
                  color={classificationColor(detailEmail.classification)}
                />

                <Chip
                  size="small"
                  label={detailEmail.status}
                  color={statusColor(detailEmail.status)}
                />

                <Chip
                  size="small"
                  variant="outlined"
                  label={detailEmail.id}
                />
              </Stack>

              <Box>
                <Typography variant="body2">
                  <strong>From:</strong> {detailEmail.from_name}{' '}
                  &lt;{detailEmail.sender}&gt;
                </Typography>

                <Typography variant="body2">
                  <strong>Received:</strong>{' '}
                  {formatDateTime(detailEmail.received_at)}
                </Typography>

                <Typography variant="body2">
                  <strong>Confidence:</strong>{' '}
                  {detailEmail.classification_confidence || '—'}
                </Typography>
              </Box>

              <Box>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: '#667085' }}
                >
                  BODY EXCERPT
                </Typography>

                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    backgroundColor: '#F4F6FA',
                    borderRadius: 1,
                    p: 1.5,
                    mt: 0.5,
                  }}
                >
                  {detailEmail.body_excerpt || '(no body captured)'}
                </Typography>
              </Box>

              <Box>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: '#667085' }}
                >
                  ATTACHMENTS
                </Typography>

                {detailEmail.attachments.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    This email has no attachments.
                  </Typography>
                ) : (
                  <TableContainer sx={{ mt: 1 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>File</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Invoice</TableCell>
                          <TableCell>Error</TableCell>
                          <TableCell align="right" />
                        </TableRow>
                      </TableHead>

                      <TableBody>
                        {detailEmail.attachments.map((attachment) => (
                          <TableRow
                            key={`${attachment.filename}-${attachment.order}`}
                          >
                            <TableCell>
                              {attachment.filename}

                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block' }}
                              >
                                {attachment.content_type}
                              </Typography>
                            </TableCell>

                            <TableCell>
                              <Chip
                                size="small"
                                label={attachment.status}
                                color={attachmentColor(
                                  attachment.status
                                )}
                              />
                            </TableCell>

                            <TableCell>
                              {attachment.invoice_id ? (
                                <Button
                                  size="small"
                                  sx={{
                                    textTransform: 'none',
                                    p: 0,
                                    minWidth: 0,
                                  }}
                                  onClick={() =>
                                    openInvoice(
                                      attachment.invoice_id as string
                                    )
                                  }
                                >
                                  {attachment.invoice_id}
                                </Button>
                              ) : (
                                '—'
                              )}
                            </TableCell>

                            <TableCell>
                              <Typography
                                variant="caption"
                                color="error.main"
                                sx={{ overflowWrap: 'anywhere' }}
                              >
                                {attachment.error || '—'}
                              </Typography>
                            </TableCell>

                            <TableCell align="right">
                              {canManageInbox(user.role) &&
                                !attachment.invoice_id &&
                                detailEmail.classification !==
                                  'NOT_INVOICE' &&
                                detailEmail.status !== 'DISMISSED' && (
                                  <Button
                                    size="small"
                                    onClick={() =>
                                      requestIngest(
                                        detailEmail,
                                        attachment.filename
                                      )
                                    }
                                  >
                                    Ingest
                                  </Button>
                                )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Box>

              {detailEmail.invoice_ids.length > 0 && (
                <Box>
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, color: '#667085' }}
                  >
                    INVOICES
                  </Typography>

                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ flexWrap: 'wrap', mt: 0.5 }}
                  >
                    {detailEmail.invoice_ids.map((invoiceId) => (
                      <Button
                        key={invoiceId}
                        size="small"
                        variant="outlined"
                        onClick={() => openInvoice(invoiceId)}
                      >
                        {invoiceId}
                      </Button>
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setDetailEmail(null)}>Close</Button>

          {detailEmail && canDismiss(detailEmail) && (
            <Button
              color="error"
              onClick={() => requestDismiss(detailEmail)}
            >
              Dismiss email
            </Button>
          )}

          {detailEmail && canIngest(detailEmail) && (
            <Button
              variant="contained"
              onClick={() => requestIngest(detailEmail)}
              sx={{
                backgroundColor: '#404D73',
                '&:hover': { backgroundColor: '#354263' },
              }}
            >
              Ingest all attachments
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* CONFIRMATION */}
      <Dialog
        open={pendingAction !== null}
        onClose={() => {
          if (!actionLoading) setPendingAction(null)
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
          {actionTitle}
        </DialogTitle>

        <DialogContent dividers>
          {actionError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {actionError.code}
              </Typography>

              <Typography variant="body2">{actionError.message}</Typography>

              {actionError.hint && (
                <Typography variant="caption">{actionError.hint}</Typography>
              )}
            </Alert>
          )}

          {pendingAction?.kind === 'sync' && (
            <>
              <Typography variant="body2">
                Sync classifies the AP inbox and creates one draft invoice per
                invoice attachment.
              </Typography>

              <Typography variant="body2" sx={{ mt: 1 }}>
                It processes every unprocessed attachment in the mailbox, so it
                can create many drafts. Continue?
              </Typography>
            </>
          )}

          {pendingAction?.kind === 'ingest' && (
            <>
              <Typography variant="body2">
                Ingest{' '}
                {pendingAction.attachment
                  ? `“${pendingAction.attachment}”`
                  : 'all unprocessed attachments'}{' '}
                from {pendingAction.email.id}?
              </Typography>

              <Typography variant="body2" sx={{ mt: 1 }}>
                A DRAFT invoice is created for each attachment. Extraction
                failures produce a reviewable BLOCKED draft, never a crash.
              </Typography>

              {pendingAction.email.classification === 'UNCERTAIN' && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  This email is classified UNCERTAIN. Confirm the attachment is
                  a supplier invoice before ingesting.
                </Alert>
              )}
            </>
          )}

          {pendingAction?.kind === 'dismiss' && (
            <Typography variant="body2">
              Dismiss {pendingAction.email.id}? It stays in the audit trail and
              can no longer be ingested.
            </Typography>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2.5 }}>
          <Button
            onClick={() => setPendingAction(null)}
            disabled={actionLoading}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            color={pendingAction?.kind === 'dismiss' ? 'error' : 'primary'}
            disabled={actionLoading}
            onClick={() => {
              void handleConfirm()
            }}
            sx={
              pendingAction?.kind === 'dismiss'
                ? undefined
                : {
                    backgroundColor: '#404D73',
                    '&:hover': { backgroundColor: '#354263' },
                  }
            }
          >
            {actionLoading
              ? 'Working...'
              : pendingAction?.kind === 'sync'
                ? 'Sync inbox'
                : pendingAction?.kind === 'dismiss'
                  ? 'Dismiss'
                  : 'Ingest'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={6000}
        onClose={() => setNotice('')}
        message={notice}
      />
    </Box>
  )
}
