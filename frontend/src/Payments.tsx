import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

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
  Radio,
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

import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import RefreshIcon from '@mui/icons-material/Refresh'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

import {
  invoiceService,
  paymentService,
  type Invoice,
  type Payment,
  type User,
} from './api/services'

import { describeError, type ErrorPresentation } from './api/errors'

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

// Contract §2.2 / §8. The server enforces both; these sets only decide whether
// the control is worth showing.
const PREPARE_ROLES = new Set<string>([
  'AP_CLERK',
  'FINANCE_MANAGER',
  'CONTROLLER',
])
const RELEASE_ROLES = new Set<string>(['FINANCE_MANAGER', 'CONTROLLER'])

type PaymentGroup =
  | 'PREPARED'
  | 'SCHEDULED'
  | 'PAID'
  | 'CANCELLED'
  | 'FAILED'
  | 'OTHER'

type GroupFilter = 'ALL' | PaymentGroup

interface StatusDescription {
  label: string
  group: PaymentGroup
  color: 'success' | 'warning' | 'error' | 'info' | 'default'
}

/**
 * The read API normalizes the dataset's historical statuses to the canonical
 * enum (`settled`/`outstanding` arrive as `PAID`/`SCHEDULED`). Keep a single
 * display mapping so an unexpected value still renders instead of crashing.
 */
function describePaymentStatus(status: string): StatusDescription {
  switch (status) {
    case 'PREPARED':
      return { label: 'Prepared', group: 'PREPARED', color: 'info' }
    case 'SCHEDULED':
      return { label: 'Scheduled', group: 'SCHEDULED', color: 'info' }
    case 'RELEASED':
      return { label: 'Released', group: 'OTHER', color: 'info' }
    case 'PAID':
      return { label: 'Paid', group: 'PAID', color: 'success' }
    case 'CANCELLED':
      return { label: 'Cancelled', group: 'CANCELLED', color: 'default' }
    case 'FAILED':
      return { label: 'Failed', group: 'FAILED', color: 'error' }
    default:
      return {
        label: status ? status.replace(/_/g, ' ') : 'Unknown',
        group: 'OTHER',
        color: 'default',
      }
  }
}

function isReleaseable(status: string): boolean {
  const group = describePaymentStatus(status).group
  return group === 'PREPARED' || group === 'SCHEDULED'
}

function formatRole(role: string): string {
  return role
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function formatMoney(
  amount: string | null,
  currency: string | null
): string {
  if (amount === null) return '—'
  return `${currency ?? ''} ${amount}`.trim()
}

function formatDate(value: string | null): string {
  if (!value) return '—'

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value

  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleDateString('en-CA', { dateStyle: 'medium' })
}

/** Add money strings without converting them to floats. */
function sumMoney(values: Array<string | null>): string {
  let cents = BigInt(0)

  for (const value of values) {
    if (!value) continue

    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim())
    if (!match) continue

    const [, sign, whole, rawFraction = ''] = match
    const fraction = BigInt(`${rawFraction}00`.slice(0, 2))
    const amount = BigInt(whole) * BigInt(100) + fraction

    cents += sign === '-' ? -amount : amount
  }

  const negative = cents < BigInt(0)
  const absolute = negative ? -cents : cents
  const whole = absolute / BigInt(100)
  const fraction = (absolute % BigInt(100)).toString().padStart(2, '0')

  return `${negative ? '-' : ''}${whole}.${fraction}`
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

interface PaymentsProps {
  user: User
  onDataChanged: () => void | Promise<void>
}

export default function Payments({ user, onDataChanged }: PaymentsProps) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ErrorPresentation | null>(null)

  const [statusFilter, setStatusFilter] = useState<GroupFilter>('ALL')
  const [query, setQuery] = useState('')

  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)

  const [notice, setNotice] = useState('')

  // Prepare dialog
  const [prepareOpen, setPrepareOpen] = useState(false)
  const [approvedInvoices, setApprovedInvoices] = useState<Invoice[]>([])
  const [approvedLoading, setApprovedLoading] = useState(false)
  const [approvedError, setApprovedError] =
    useState<ErrorPresentation | null>(null)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [prepareError, setPrepareError] =
    useState<ErrorPresentation | null>(null)

  // Release dialog
  const [releaseTarget, setReleaseTarget] = useState<Payment | null>(null)
  const [releaseInvoice, setReleaseInvoice] = useState<Invoice | null>(null)
  const [releaseInvoiceLoading, setReleaseInvoiceLoading] = useState(false)
  const [releaseInvoiceError, setReleaseInvoiceError] =
    useState<ErrorPresentation | null>(null)
  const [releasing, setReleasing] = useState(false)
  const [releaseError, setReleaseError] =
    useState<ErrorPresentation | null>(null)

  const canPrepare = PREPARE_ROLES.has(user.role)
  const canRelease = RELEASE_ROLES.has(user.role)

  // --------------------------------------------------
  // LOAD PAYMENTS
  // --------------------------------------------------

  const loadPayments = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await paymentService.listAll({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
      })
      setPayments(response.results)
      setTotal(response.count)
    } catch (err) {
      setError(describeError(err))
      setPayments([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    async function load() {
      await loadPayments()
    }

    void load()
  }, [loadPayments])

  // Load approved invoices when the prepare dialog opens.
  useEffect(() => {
    if (!prepareOpen) return

    let cancelled = false

    invoiceService
      .listAll({ status: 'APPROVED' })
      .then((response) => {
        if (cancelled) return
        setApprovedInvoices(response.results)
        setApprovedLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setApprovedError(describeError(err))
        setApprovedLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [prepareOpen])

  // Load the invoice behind the payment being released so the dialog can show
  // the vendor and check separation of duties client-side.
  useEffect(() => {
    if (!releaseTarget || !releaseTarget.invoice_id) return

    let cancelled = false
    const invoiceId = releaseTarget.invoice_id

    invoiceService
      .get(invoiceId)
      .then((invoice) => {
        if (cancelled) return
        setReleaseInvoice(invoice)
        setReleaseInvoiceLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setReleaseInvoiceError(describeError(err))
        setReleaseInvoiceLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [releaseTarget])

  // --------------------------------------------------
  // DERIVED
  // --------------------------------------------------

  const filteredPayments = useMemo(() => {
    const term = query.trim().toLowerCase()

    if (!term) return payments

    return payments.filter(
      (payment) =>
        payment.id.toLowerCase().includes(term) ||
        (payment.invoice_id ?? '').toLowerCase().includes(term) ||
        (payment.reference ?? '').toLowerCase().includes(term)
    )
  }, [payments, query])

  const visiblePayments = filteredPayments.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  )

  const awaitingRelease = payments.filter((payment) =>
    isReleaseable(payment.status)
  )

  const awaitingCad = sumMoney(
    awaitingRelease.map((payment) => payment.amount_cad)
  )

  const paidCount = payments.filter(
    (payment) => describePaymentStatus(payment.status).group === 'PAID'
  ).length

  const approvedByMe = Boolean(
    releaseInvoice?.approvals.some(
      (step) =>
        step.status === 'APPROVED' && step.approver?.id === user.id
    )
  )

  const releaseBlocked =
    approvedByMe || releaseInvoice?.status === 'PAID'

  // --------------------------------------------------
  // ACTIONS
  // --------------------------------------------------

  function openPrepare() {
    setApprovedInvoices([])
    setSelectedInvoiceId('')
    setPrepareError(null)
    setApprovedError(null)
    setApprovedLoading(true)
    setPrepareOpen(true)
  }

  function openRelease(payment: Payment) {
    setReleaseError(null)
    setReleaseInvoice(null)
    setReleaseInvoiceError(null)
    setReleaseInvoiceLoading(Boolean(payment.invoice_id))
    setReleaseTarget(payment)
  }

  async function handlePrepare() {
    if (!selectedInvoiceId) return

    setPreparing(true)
    setPrepareError(null)

    try {
      const payment = await paymentService.prepare(selectedInvoiceId)

      setNotice(
        `Payment ${payment.id} prepared for invoice ${payment.invoice_id}.`
      )
      setPrepareOpen(false)

      await loadPayments()
      await onDataChanged()
    } catch (err) {
      setPrepareError(describeError(err))
    } finally {
      setPreparing(false)
    }
  }

  async function handleRelease() {
    if (!releaseTarget) return

    setReleasing(true)
    setReleaseError(null)

    try {
      const payment = await paymentService.release(releaseTarget.id)

      setNotice(
        payment.status === 'PAID'
          ? `Payment ${payment.id} released. Invoice ${payment.invoice_id} is now PAID (simulated).`
          : `Payment ${payment.id} is now ${payment.status}.`
      )
      setReleaseTarget(null)

      await loadPayments()
      await onDataChanged()
    } catch (err) {
      setReleaseError(describeError(err))
    } finally {
      setReleasing(false)
    }
  }

  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------

  return (
    <Box>
      {/* HEADER */}
      <Card
        sx={{
          backgroundColor: '#404D73',
          color: '#FFFFFF',
          mb: 3,
          borderRadius: 3,
        }}
      >
        <CardContent sx={{ p: 4 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{
              justifyContent: 'space-between',
              alignItems: { xs: 'flex-start', md: 'center' },
            }}
          >
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <AccountBalanceWalletIcon sx={{ fontSize: 36 }} />

              <Box>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                  Payment Management
                </Typography>

                <Typography sx={{ color: '#E0E5F0', mt: 0.5 }}>
                  Prepare and release simulated EFT payments for approved
                  invoices
                </Typography>
              </Box>
            </Stack>

            <Stack direction="row" spacing={2}>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                disabled={loading}
                onClick={() => {
                  void loadPayments()
                }}
                sx={{
                  color: '#FFFFFF',
                  borderColor: '#FFFFFF',
                  '&:hover': { borderColor: '#E0E5F0' },
                }}
              >
                Refresh
              </Button>

              {canPrepare && (
                <Button
                  variant="contained"
                  onClick={openPrepare}
                  sx={{
                    backgroundColor: '#C7F36B',
                    color: '#263451',
                    fontWeight: 700,
                    '&:hover': { backgroundColor: '#B5E15C' },
                  }}
                >
                  Prepare payment
                </Button>
              )}
            </Stack>
          </Stack>

          <Typography
            variant="caption"
            sx={{ display: 'block', mt: 2, color: '#E0E5F0' }}
          >
            Signed in as {user.full_name} ({formatRole(user.role)}) —{' '}
            {canPrepare ? 'can prepare' : 'cannot prepare'};{' '}
            {canRelease ? 'can release' : 'cannot release'}. Released payments
            are simulated; no funds move.
          </Typography>
        </CardContent>
      </Card>

      {/* SUMMARY */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={3}
        sx={{ mb: 3 }}
      >
        {[
          {
            label: 'Payments in view',
            value: total,
            color: '#263451',
            icon: <AccountBalanceWalletIcon />,
          },
          {
            label: 'Awaiting Release',
            value: awaitingRelease.length,
            color: '#404D73',
            icon: <AccessTimeIcon />,
          },
          {
            label: 'Awaiting (CAD)',
            value: awaitingCad,
            color: '#B86B00',
            icon: <AccountBalanceWalletIcon />,
          },
          {
            label: 'Paid',
            value: paidCount,
            color: '#166534',
            icon: <CheckCircleIcon />,
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

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mb: 2 }}
      >
        Summary cards reflect the selected status filter; search narrows the
        current result.
      </Typography>

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
              placeholder="Payment ID, invoice ID or reference"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(0)
              }}
            />

            <FormControl size="small" sx={{ minWidth: 190 }}>
              <InputLabel>Status</InputLabel>

              <Select
                label="Status"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as GroupFilter)
                  setPage(0)
                }}
              >
                <MenuItem value="ALL">All statuses</MenuItem>
                <MenuItem value="PREPARED">Prepared</MenuItem>
                <MenuItem value="SCHEDULED">Scheduled</MenuItem>
                <MenuItem value="PAID">Paid</MenuItem>
                <MenuItem value="CANCELLED">Cancelled</MenuItem>
                <MenuItem value="FAILED">Failed</MenuItem>
              </Select>
            </FormControl>

            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {filteredPayments.length === total
                ? `${total} payment${total === 1 ? '' : 's'}`
                : `${filteredPayments.length} of ${total} payments match`}
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
                void loadPayments()
              }}
            >
              Retry
            </Button>
          }
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Could not load payments ({error.code})
          </Typography>

          <Typography variant="body2">{error.message}</Typography>

          {error.hint && (
            <Typography variant="caption">{error.hint}</Typography>
          )}
        </Alert>
      )}

      {/* PAYMENT TABLE */}
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
              Loading payments...
            </Typography>
          </Box>
        ) : filteredPayments.length === 0 ? (
          <Box sx={{ p: 4 }}>
            <Typography sx={{ fontWeight: 600, color: '#263451' }}>
              {error
                ? 'Payments could not be loaded.'
                : 'No payments match this view.'}
            </Typography>

            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {error
                ? 'Use Retry above to try again.'
                : canPrepare
                  ? 'Use “Prepare payment” to create a payment for an approved invoice.'
                  : 'Payments appear once an approved invoice is prepared for payment.'}
            </Typography>
          </Box>
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <TableHead sx={{ backgroundColor: '#E9EDF5' }}>
                  <TableRow>
                    <TableCell>Payment</TableCell>
                    <TableCell>Invoice</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Amount</TableCell>
                    <TableCell>Amount (CAD)</TableCell>
                    <TableCell>Method</TableCell>
                    <TableCell>Scheduled</TableCell>
                    <TableCell>Paid</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {visiblePayments.map((payment) => {
                    const status = describePaymentStatus(payment.status)
                    const canReleaseThis =
                      canRelease && isReleaseable(payment.status)

                    return (
                      <TableRow key={payment.id} hover>
                        <TableCell>
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 600 }}
                          >
                            {payment.id}
                          </Typography>

                          {payment.reference && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {payment.reference}
                            </Typography>
                          )}
                        </TableCell>

                        <TableCell>{payment.invoice_id ?? '—'}</TableCell>

                        <TableCell>
                          <Chip
                            size="small"
                            label={status.label}
                            color={status.color}
                            sx={{ fontWeight: 600 }}
                          />
                        </TableCell>

                        <TableCell>
                          {formatMoney(payment.amount, payment.currency)}
                        </TableCell>

                        <TableCell>
                          {payment.amount_cad
                            ? `CAD ${payment.amount_cad}`
                            : '—'}
                        </TableCell>

                        <TableCell>{payment.method || '—'}</TableCell>

                        <TableCell>
                          {formatDate(payment.scheduled_date)}
                        </TableCell>

                        <TableCell>{formatDate(payment.paid_date)}</TableCell>

                        <TableCell align="right">
                          {canReleaseThis ? (
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => {
                                openRelease(payment)
                              }}
                              sx={{
                                backgroundColor: '#404D73',
                                '&:hover': {
                                  backgroundColor: '#354263',
                                },
                              }}
                            >
                              Release
                            </Button>
                          ) : isReleaseable(payment.status) ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Finance / Controller only
                            </Typography>
                          ) : (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                            >
                              —
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>

            <TablePagination
              component="div"
              count={filteredPayments.length}
              page={page}
              rowsPerPage={rowsPerPage}
              rowsPerPageOptions={[10, 25, 50, 100]}
              onPageChange={(_event, newPage) => setPage(newPage)}
              onRowsPerPageChange={(event) => {
                setRowsPerPage(Number(event.target.value))
                setPage(0)
              }}
            />
          </>
        )}
      </Card>

      {/* PREPARE DIALOG */}
      <Dialog
        open={prepareOpen}
        onClose={() => {
          if (!preparing) setPrepareOpen(false)
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
          Prepare payment
        </DialogTitle>

        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose an APPROVED invoice. Preparing creates a simulated payment
            in PREPARED status; it does not move funds.
          </Typography>

          {prepareError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {prepareError.code}
              </Typography>

              <Typography variant="body2">{prepareError.message}</Typography>

              {prepareError.hint && (
                <Typography variant="caption">{prepareError.hint}</Typography>
              )}
            </Alert>
          )}

          {approvedLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
              <CircularProgress size={20} />

              <Typography color="text.secondary">
                Loading approved invoices...
              </Typography>
            </Box>
          ) : approvedError ? (
            <Alert severity="warning">
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Could not load approved invoices ({approvedError.code})
              </Typography>

              <Typography variant="body2">
                {approvedError.message}
              </Typography>
            </Alert>
          ) : approvedInvoices.length === 0 ? (
            <Alert severity="info">
              No invoices are currently APPROVED and waiting for payment.
              Approve an invoice first (Invoices → submit → approval), then
              return here.
            </Alert>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell />
                    <TableCell>Invoice</TableCell>
                    <TableCell>Vendor</TableCell>
                    <TableCell>Amount</TableCell>
                    <TableCell>Amount (CAD)</TableCell>
                    <TableCell>Due</TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {approvedInvoices.map((invoice) => (
                    <TableRow
                      key={invoice.id}
                      hover
                      selected={selectedInvoiceId === invoice.id}
                      onClick={() => setSelectedInvoiceId(invoice.id)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell padding="checkbox">
                        <Radio
                          checked={selectedInvoiceId === invoice.id}
                          onChange={() =>
                            setSelectedInvoiceId(invoice.id)
                          }
                          slotProps={{
                            input: {
                              'aria-label': `Select ${invoice.id}`,
                            },
                          }}
                        />
                      </TableCell>

                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {invoice.id}
                        </Typography>

                        <Typography variant="caption" color="text.secondary">
                          {invoice.invoice_number ?? 'No vendor number'}
                        </Typography>
                      </TableCell>

                      <TableCell>
                        {invoice.vendor?.legal_name ?? 'Unknown vendor'}
                      </TableCell>

                      <TableCell>
                        {formatMoney(invoice.total, invoice.currency)}
                      </TableCell>

                      <TableCell>
                        {invoice.total_cad ? `CAD ${invoice.total_cad}` : '—'}
                      </TableCell>

                      <TableCell>{formatDate(invoice.due_date)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2.5 }}>
          <Button
            onClick={() => setPrepareOpen(false)}
            disabled={preparing}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            disabled={!selectedInvoiceId || preparing}
            onClick={() => {
              void handlePrepare()
            }}
            sx={{
              backgroundColor: '#404D73',
              '&:hover': { backgroundColor: '#354263' },
            }}
          >
            {preparing ? 'Preparing...' : 'Prepare payment'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* RELEASE DIALOG */}
      <Dialog
        open={releaseTarget !== null}
        onClose={() => {
          if (!releasing) setReleaseTarget(null)
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
          Release payment
        </DialogTitle>

        <DialogContent dividers>
          {releaseTarget && (
            <Box>
              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <Chip
                  size="small"
                  label={describePaymentStatus(releaseTarget.status).label}
                  color={describePaymentStatus(releaseTarget.status).color}
                />

                <Chip
                  size="small"
                  variant="outlined"
                  label={`Invoice ${releaseTarget.invoice_id ?? '—'}`}
                />
              </Stack>

              <DetailRow label="Payment">
                <Typography variant="body2">
                  {releaseTarget.id}
                  {releaseTarget.reference
                    ? ` · ${releaseTarget.reference}`
                    : ''}
                </Typography>
              </DetailRow>

              <DetailRow label="Amount">
                <Typography variant="body2">
                  {formatMoney(
                    releaseTarget.amount,
                    releaseTarget.currency
                  )}
                  {releaseTarget.amount_cad
                    ? ` · CAD ${releaseTarget.amount_cad}`
                    : ''}
                </Typography>
              </DetailRow>

              <DetailRow label="Method">
                <Typography variant="body2">
                  {releaseTarget.method || '—'}
                </Typography>
              </DetailRow>

              <DetailRow label="Scheduled">
                <Typography variant="body2">
                  {formatDate(releaseTarget.scheduled_date)}
                </Typography>
              </DetailRow>

              <DetailRow label="Bank account">
                <Typography variant="body2">
                  {releaseTarget.bank_account_masked ?? 'Not captured'}
                </Typography>
              </DetailRow>

              <Divider sx={{ my: 2 }} />

              {releaseInvoiceLoading && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    py: 1,
                  }}
                >
                  <CircularProgress size={18} />

                  <Typography variant="body2" color="text.secondary">
                    Checking invoice and approval chain...
                  </Typography>
                </Box>
              )}

              {releaseInvoiceError && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Invoice details unavailable ({releaseInvoiceError.code})
                  </Typography>

                  <Typography variant="body2">
                    {releaseInvoiceError.message}
                  </Typography>
                </Alert>
              )}

              {releaseInvoice && (
                <Box sx={{ mb: 2 }}>
                  <DetailRow label="Vendor">
                    <Typography variant="body2">
                      {releaseInvoice.vendor?.legal_name ??
                        'Unknown vendor'}
                    </Typography>
                  </DetailRow>

                  <DetailRow label="Invoice status">
                    <Chip
                      size="small"
                      label={releaseInvoice.status.replace(/_/g, ' ')}
                      color={
                        releaseInvoice.status === 'PAID'
                          ? 'success'
                          : 'warning'
                      }
                    />
                  </DetailRow>
                </Box>
              )}

              {releaseInvoice?.status === 'PAID' && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  This invoice is already PAID. Releasing again is not needed.
                </Alert>
              )}

              {approvedByMe && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  You approved this invoice, so you cannot release its payment
                  (separation of duties). Another Finance Manager or a
                  Controller must release it.
                </Alert>
              )}

              {releaseError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {releaseError.code}
                  </Typography>

                  <Typography variant="body2">
                    {releaseError.message}
                  </Typography>

                  {releaseError.hint && (
                    <Typography variant="caption">
                      {releaseError.hint}
                    </Typography>
                  )}
                </Alert>
              )}

              <Alert severity="info" icon={<WarningAmberIcon />}>
                This performs the explicit human release and the simulated
                execution in one step: the payment becomes PAID and the invoice
                becomes PAID. No real money moves.
              </Alert>
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2.5 }}>
          <Button
            onClick={() => setReleaseTarget(null)}
            disabled={releasing}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            disabled={
              releasing ||
              releaseInvoiceLoading ||
              releaseBlocked
            }
            onClick={() => {
              void handleRelease()
            }}
            sx={{
              backgroundColor: '#2E7D4F',
              '&:hover': { backgroundColor: '#24643F' },
            }}
          >
            {releasing ? 'Releasing...' : 'Release payment'}
          </Button>
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
