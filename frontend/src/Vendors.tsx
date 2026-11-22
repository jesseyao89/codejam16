import { useCallback, useEffect, useRef, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
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

import CloseIcon from '@mui/icons-material/Close'
import RefreshIcon from '@mui/icons-material/Refresh'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'

import {
  vendorService,
  type BankChange,
  type VendorDetail,
} from './api/services'

import { describeError, type ErrorPresentation } from './api/errors'

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

type StatusFilter = 'ALL' | 'active' | 'on_hold' | 'pending_review'

interface VendorSummary {
  total: number
  active: number
  onHold: number
  pendingReview: number
}

function vendorStatusColor(
  status: string
): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'active':
      return 'success'
    case 'on_hold':
      return 'error'
    case 'pending_review':
      return 'warning'
    default:
      return 'default'
  }
}

function bankChangeColor(
  status: string | null
): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'approved':
      return 'success'
    case 'pending':
      return 'warning'
    case 'rejected':
      return 'error'
    default:
      return 'default'
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—'

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value

  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleDateString('en-CA', { dateStyle: 'medium' })
}

function formatLabel(value: string | null): string {
  return value ? value.replace(/_/g, ' ') : '—'
}

// --------------------------------------------------
// DETAIL DRAWER
// --------------------------------------------------

function VendorDetailDrawer({
  vendorId,
  onClose,
}: {
  vendorId: string
  onClose: () => void
}) {
  const [vendor, setVendor] = useState<VendorDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ErrorPresentation | null>(null)
  const [vendorReloadToken, setVendorReloadToken] = useState(0)

  const [bankChanges, setBankChanges] = useState<BankChange[]>([])
  const [bankLoading, setBankLoading] = useState(true)
  const [bankError, setBankError] = useState<ErrorPresentation | null>(null)
  const [bankReloadToken, setBankReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    vendorService
      .get(vendorId)
      .then((data) => {
        if (cancelled) return
        setVendor(data)
        setError(null)
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
  }, [vendorId, vendorReloadToken])

  useEffect(() => {
    let cancelled = false

    vendorService
      .bankChanges(vendorId)
      .then((response) => {
        if (cancelled) return
        setBankChanges(response.results)
        setBankError(null)
        setBankLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setBankError(describeError(err))
        setBankLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [vendorId, bankReloadToken])

  function retryVendor() {
    setLoading(true)
    setError(null)
    setVendorReloadToken((token) => token + 1)
  }

  function retryBankChanges() {
    setBankLoading(true)
    setBankError(null)
    setBankReloadToken((token) => token + 1)
  }

  return (
    <Drawer
      anchor="right"
      open
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100%', sm: 680 },
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
            <Box>
              <Typography
                variant="overline"
                sx={{ color: '#DDE4F5', letterSpacing: 1.5 }}
              >
                BLUEBERI / VENDOR
              </Typography>

              <Typography
                variant="h5"
                sx={{ fontWeight: 700, mt: 1, overflowWrap: 'anywhere' }}
              >
                {vendor?.legal_name ?? vendorId}
              </Typography>

              <Typography sx={{ color: '#E0E5F0', mt: 0.5 }}>
                {vendorId}
                {vendor ? ` · ${vendor.category || 'Uncategorised'}` : ''}
              </Typography>
            </Box>

            <IconButton
              onClick={onClose}
              sx={{ color: '#FFFFFF' }}
              aria-label="Close vendor details"
            >
              <CloseIcon />
            </IconButton>
          </Stack>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', px: 4, py: 3 }}>
          {loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <CircularProgress size={22} />
              <Typography color="text.secondary">
                Loading vendor...
              </Typography>
            </Box>
          )}

          {error && !vendor && (
            <Alert
              severity="error"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={retryVendor}
                >
                  Retry
                </Button>
              }
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Could not load vendor ({error.code})
              </Typography>

              <Typography variant="body2">{error.message}</Typography>
            </Alert>
          )}

          {vendor && (
            <Stack spacing={3}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Chip
                  label={formatLabel(vendor.status)}
                  color={vendorStatusColor(vendor.status)}
                  sx={{ fontWeight: 700 }}
                />

                {vendor.requires_po === 'yes' && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label="PO required"
                  />
                )}

                {vendor.accepts_card_payment === 'yes' && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label="Accepts card"
                  />
                )}
              </Stack>

              <Box>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: '#667085' }}
                >
                  CONTACT & ADDRESS
                </Typography>

                {[
                  ['Legal name', vendor.legal_name],
                  ['Address', vendor.address || '—'],
                  ['Province / state', vendor.province_or_state || '—'],
                  ['Country', vendor.country || '—'],
                  ['AP contact', vendor.ap_contact_email || '—'],
                ].map(([label, value]) => (
                  <Stack
                    key={label}
                    direction="row"
                    spacing={2}
                    sx={{ py: 0.4 }}
                  >
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ minWidth: 140, flexShrink: 0 }}
                    >
                      {label}
                    </Typography>

                    <Typography
                      variant="body2"
                      sx={{ overflowWrap: 'anywhere' }}
                    >
                      {value}
                    </Typography>
                  </Stack>
                ))}
              </Box>

              <Box>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: '#667085' }}
                >
                  FINANCIAL TERMS
                </Typography>

                {[
                  [
                    'Payment terms',
                    vendor.payment_terms_days !== null
                      ? `${vendor.payment_terms_days} days`
                      : '—',
                  ],
                  [
                    'Preferred method',
                    vendor.preferred_payment_method || '—',
                  ],
                  [
                    'Early-pay discount',
                    vendor.early_pay_discount || '—',
                  ],
                  [
                    'Default GL account',
                    vendor.default_gl_account || '—',
                  ],
                  ['Onboarded', formatDate(vendor.onboarded_at)],
                ].map(([label, value]) => (
                  <Stack
                    key={label}
                    direction="row"
                    spacing={2}
                    sx={{ py: 0.4 }}
                  >
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ minWidth: 140, flexShrink: 0 }}
                    >
                      {label}
                    </Typography>

                    <Typography variant="body2">{value}</Typography>
                  </Stack>
                ))}
              </Box>

              <Box>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: '#667085' }}
                >
                  BANK DETAILS (MASKED)
                </Typography>

                {[
                  [
                    'Account',
                    vendor.bank_account_masked ?? 'Not captured',
                  ],
                  [
                    'Institution',
                    vendor.bank_institution ?? 'Not captured',
                  ],
                  [
                    'Last updated',
                    formatDate(vendor.bank_details_updated_at),
                  ],
                  [
                    'Pending change',
                    vendor.pending_bank_change
                      ? formatLabel(vendor.pending_bank_change.status)
                      : 'None recorded',
                  ],
                ].map(([label, value]) => (
                  <Stack
                    key={label}
                    direction="row"
                    spacing={2}
                    sx={{ py: 0.4 }}
                  >
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ minWidth: 140, flexShrink: 0 }}
                    >
                      {label}
                    </Typography>

                    <Typography variant="body2">{value}</Typography>
                  </Stack>
                ))}
              </Box>

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
                    Bank-change history
                  </Typography>
                </Stack>

                <Alert severity="info" sx={{ mb: 2 }}>
                  Historical bank-change rows do not carry lifecycle status or
                  decision metadata in this backend build. “Not tracked” means
                  unknown — it is not an inference that the change was
                  approved.
                </Alert>

                {bankLoading ? (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                    }}
                  >
                    <CircularProgress size={18} />
                    <Typography color="text.secondary">
                      Loading bank changes...
                    </Typography>
                  </Box>
                ) : bankError ? (
                  <Alert
                    severity="warning"
                    action={
                      <Button
                        color="inherit"
                        size="small"
                        onClick={retryBankChanges}
                      >
                        Retry
                      </Button>
                    }
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      Could not load bank changes ({bankError.code})
                    </Typography>

                    <Typography variant="body2">
                      {bankError.message}
                    </Typography>
                  </Alert>
                ) : bankChanges.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No bank-change records.
                  </Typography>
                ) : (
                  <TableContainer
                    sx={{ border: '1px solid #E5E7EB', borderRadius: 1 }}
                  >
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ backgroundColor: '#EEF1F7' }}>
                          <TableCell sx={{ fontWeight: 700 }}>
                            Change
                          </TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>
                            Changed
                          </TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>
                            Channel
                          </TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>
                            Callback
                          </TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>
                            Account
                          </TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>
                            Status
                          </TableCell>
                        </TableRow>
                      </TableHead>

                      <TableBody>
                        {bankChanges.map((change) => (
                          <TableRow key={change.id}>
                            <TableCell>{change.id}</TableCell>
                            <TableCell>
                              {formatDate(change.changed_at)}
                            </TableCell>
                            <TableCell>
                              {formatLabel(change.request_channel)}
                            </TableCell>
                            <TableCell>
                              {formatLabel(change.verified_by_callback)}
                            </TableCell>
                            <TableCell>
                              **** {change.old_account_last4 ?? '????'} → ****{' '}
                              {change.new_account_last4 ?? '????'}
                            </TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={
                                  change.status
                                    ? formatLabel(change.status)
                                    : 'Not tracked'
                                }
                                color={bankChangeColor(change.status)}
                                variant="outlined"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Box>

              <Alert severity="info" icon={<LockOutlinedIcon />}>
                Vendor master is read-only in this build. Onboarding, holds,
                approvals and bank-change requests require the vendor
                management API, which is not available yet.
              </Alert>
            </Stack>
          )}
        </Box>
      </Box>
    </Drawer>
  )
}

// --------------------------------------------------
// PAGE
// --------------------------------------------------

export default function Vendors() {
  const [vendors, setVendors] = useState<VendorDetail[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ErrorPresentation | null>(null)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')

  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)

  const listRequestRef = useRef(0)
  const summaryRequestRef = useRef(0)
  const searchTimerRef = useRef<number | null>(null)

  const [summary, setSummary] = useState<VendorSummary | null>(null)
  const [summaryError, setSummaryError] =
    useState<ErrorPresentation | null>(null)

  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(
    null
  )

  const loadVendors = useCallback(async () => {
    const requestId = ++listRequestRef.current

    setLoading(true)
    setError(null)

    try {
      const response = await vendorService.list({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        q: appliedQuery.trim() || undefined,
        page: page + 1,
        page_size: rowsPerPage,
      })

      if (requestId !== listRequestRef.current) return

      setVendors(response.results)
      setCount(response.count)
    } catch (err) {
      if (requestId !== listRequestRef.current) return

      const presentation = describeError(err)

      if (presentation.code === 'NOT_FOUND' && page > 0) {
        setPage(0)
        return
      }

      setError(presentation)
      setVendors([])
      setCount(0)
    } finally {
      if (requestId === listRequestRef.current) {
        setLoading(false)
      }
    }
  }, [statusFilter, appliedQuery, page, rowsPerPage])

  useEffect(() => {
    async function load() {
      await loadVendors()
    }

    void load()

    return () => {
      listRequestRef.current += 1
    }
  }, [loadVendors])

  const loadSummary = useCallback(async () => {
    const requestId = ++summaryRequestRef.current

    try {
      const [all, active, onHold, pendingReview] = await Promise.all([
        vendorService.list({ page_size: 1 }),
        vendorService.list({ status: 'active', page_size: 1 }),
        vendorService.list({ status: 'on_hold', page_size: 1 }),
        vendorService.list({ status: 'pending_review', page_size: 1 }),
      ])

      if (requestId !== summaryRequestRef.current) return

      setSummaryError(null)
      setSummary({
        total: all.count,
        active: active.count,
        onHold: onHold.count,
        pendingReview: pendingReview.count,
      })
    } catch (err) {
      if (requestId !== summaryRequestRef.current) return
      setSummaryError(describeError(err))
    }
  }, [])

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
                Vendor Master
              </Typography>

              <Typography variant="body2" color="text.secondary">
                Read-only supplier master data and bank-change history. Bank
                accounts are always masked.
              </Typography>
            </Box>

            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              disabled={loading}
              onClick={() => {
                void loadVendors()
                void loadSummary()
              }}
            >
              Refresh
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* SUMMARY */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={3}
        sx={{ mb: 3 }}
      >
        {[
          { label: 'Vendors', value: summary?.total, color: '#263451' },
          { label: 'Active', value: summary?.active, color: '#166534' },
          { label: 'On hold', value: summary?.onHold, color: '#B42318' },
          {
            label: 'Pending review',
            value: summary?.pendingReview,
            color: '#B86B00',
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
          Vendor totals unavailable ({summaryError.code}). The list below still
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
              placeholder="Vendor name or category"
              value={query}
              onChange={(event) => {
                handleSearchChange(event.target.value)
              }}
            />

            <FormControl size="small" sx={{ minWidth: 180 }}>
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
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="on_hold">On hold</MenuItem>
                <MenuItem value="pending_review">Pending review</MenuItem>
              </Select>
            </FormControl>

            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {count} vendor{count === 1 ? '' : 's'}
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
                void loadVendors()
              }}
            >
              Retry
            </Button>
          }
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Could not load vendors ({error.code})
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
              Loading vendors...
            </Typography>
          </Box>
        ) : vendors.length === 0 ? (
          !error && (
            <Box sx={{ p: 4 }}>
              <Typography sx={{ fontWeight: 600, color: '#263451' }}>
                No vendors match this view.
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1 }}
              >
                Clear the filters or search for a different vendor.
              </Typography>
            </Box>
          )
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <TableHead sx={{ backgroundColor: '#E9EDF5' }}>
                  <TableRow>
                    <TableCell>Vendor</TableCell>
                    <TableCell>Legal name</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Province</TableCell>
                    <TableCell>Terms</TableCell>
                    <TableCell>Bank</TableCell>
                    <TableCell>PO</TableCell>
                    <TableCell>Onboarded</TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {vendors.map((vendor) => (
                    <TableRow
                      key={vendor.id}
                      hover
                      tabIndex={0}
                      onClick={() => setSelectedVendorId(vendor.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedVendorId(vendor.id)
                        }
                      }}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell sx={{ fontWeight: 600 }}>
                        {vendor.id}
                      </TableCell>

                      <TableCell>{vendor.legal_name}</TableCell>

                      <TableCell>{vendor.category || '—'}</TableCell>

                      <TableCell>
                        <Chip
                          size="small"
                          label={formatLabel(vendor.status)}
                          color={vendorStatusColor(vendor.status)}
                          sx={{ fontWeight: 600 }}
                        />
                      </TableCell>

                      <TableCell>{vendor.province_or_state || '—'}</TableCell>

                      <TableCell>
                        {vendor.payment_terms_days !== null
                          ? `${vendor.payment_terms_days} days`
                          : '—'}
                      </TableCell>

                      <TableCell>
                        {vendor.bank_account_masked ?? '—'}
                      </TableCell>

                      <TableCell>
                        {vendor.requires_po === 'yes' ? 'Required' : 'No'}
                      </TableCell>

                      <TableCell>
                        {formatDate(vendor.onboarded_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

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
          </>
        )}
      </Card>

      {selectedVendorId && (
        <VendorDetailDrawer
          key={selectedVendorId}
          vendorId={selectedVendorId}
          onClose={() => setSelectedVendorId(null)}
        />
      )}
    </Box>
  )
}
