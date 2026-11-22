import { useEffect, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'

import RefreshIcon from '@mui/icons-material/Refresh'

import {
  invoiceService,
  type Finding,
  type Invoice,
} from './api/services'

import { describeError, type ErrorPresentation } from './api/errors'
import FindingList from './Findings'

type SeverityFilter = 'ALL' | 'BLOCK' | 'WARNING'
type FindingStatusFilter = 'ALL' | 'OPEN' | 'RESOLVED'

interface FindingGroup {
  invoice: Invoice
  findings: Finding[]
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

function formatMoney(invoice: Invoice): string {
  if (invoice.total === null) return '—'
  return `${invoice.currency ?? ''} ${invoice.total}`.trim()
}

export default function ValidationReview({
  onOpenInvoice,
  refreshToken = 0,
}: {
  onOpenInvoice: (invoiceId: string) => void
  refreshToken?: number
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ErrorPresentation | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [severityFilter, setSeverityFilter] =
    useState<SeverityFilter>('ALL')
  const [statusFilter, setStatusFilter] =
    useState<FindingStatusFilter>('OPEN')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)

      try {
        const response = await invoiceService.listAll()

        if (cancelled) return

        setInvoices(response.results)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(describeError(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [reloadToken, refreshToken])

  function retry() {
    setLoading(true)
    setError(null)
    setReloadToken((token) => token + 1)
  }

  const allFindings = invoices.flatMap((invoice) => invoice.findings)

  const blockedCount = invoices.filter(
    (invoice) => invoice.validation_status === 'BLOCKED'
  ).length

  const warningCount = invoices.filter(
    (invoice) => invoice.validation_status === 'WARNING'
  ).length

  const openFindingCount = allFindings.filter(
    (finding) => finding.resolution === null
  ).length

  const resolvedFindingCount = allFindings.filter(
    (finding) => finding.resolution !== null
  ).length

  const term = query.trim().toLowerCase()

  const groups: FindingGroup[] = invoices
    .map((invoice) => ({
      invoice,
      findings: invoice.findings.filter((finding) => {
        if (
          severityFilter !== 'ALL' &&
          finding.severity !== severityFilter
        ) {
          return false
        }

        const resolved = finding.resolution !== null

        if (statusFilter === 'OPEN' && resolved) return false
        if (statusFilter === 'RESOLVED' && !resolved) return false

        if (!term) return true

        return (
          invoice.id.toLowerCase().includes(term) ||
          (invoice.vendor?.legal_name ?? '').toLowerCase().includes(term) ||
          finding.code.toLowerCase().includes(term) ||
          finding.message.toLowerCase().includes(term)
        )
      }),
    }))
    .filter((group) => group.findings.length > 0)

  const filteredFindingCount = groups.reduce(
    (count, group) => count + group.findings.length,
    0
  )

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
                Validation Review
              </Typography>

              <Typography variant="body2" color="text.secondary">
                Deterministic tax, purchase-order, contract, duplicate and
                extraction checks. Open an invoice to correct data or resolve a
                warning.
              </Typography>
            </Box>

            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              disabled={loading}
              onClick={retry}
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
          {
            label: 'Blocked invoices',
            value: blockedCount,
            color: '#B42318',
          },
          {
            label: 'Warning invoices',
            value: warningCount,
            color: '#B86B00',
          },
          {
            label: 'Open findings',
            value: openFindingCount,
            color: '#263451',
          },
          {
            label: 'Resolved findings',
            value: resolvedFindingCount,
            color: '#166534',
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
                {item.value}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>

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
              placeholder="Invoice, vendor, finding code or message"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />

            <TextField
              select
              size="small"
              label="Severity"
              value={severityFilter}
              onChange={(event) =>
                setSeverityFilter(event.target.value as SeverityFilter)
              }
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="ALL">All severities</MenuItem>
              <MenuItem value="BLOCK">Blocking</MenuItem>
              <MenuItem value="WARNING">Warnings</MenuItem>
            </TextField>

            <TextField
              select
              size="small"
              label="Finding status"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as FindingStatusFilter
                )
              }
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="OPEN">Open</MenuItem>
              <MenuItem value="RESOLVED">Resolved</MenuItem>
              <MenuItem value="ALL">All findings</MenuItem>
            </TextField>

            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {filteredFindingCount} finding
              {filteredFindingCount === 1 ? '' : 's'}
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
            <Button color="inherit" size="small" onClick={retry}>
              Retry
            </Button>
          }
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Could not load validation findings ({error.code})
          </Typography>

          <Typography variant="body2">{error.message}</Typography>

          {error.hint && (
            <Typography variant="caption">{error.hint}</Typography>
          )}
        </Alert>
      )}

      {/* GROUPS */}
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
            Loading validation findings...
          </Typography>
        </Box>
      ) : groups.length === 0 ? (
        !error && (
          <Card sx={{ p: 4, textAlign: 'center' }}>
            <Typography sx={{ fontWeight: 600, color: '#263451' }}>
              No validation findings match this view.
            </Typography>

            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Clear the filters, or refresh after invoices are analyzed.
            </Typography>
          </Card>
        )
      ) : (
        <Stack spacing={3}>
          {groups.map((group) => (
            <Card key={group.invoice.id} variant="outlined">
              <CardContent sx={{ p: 3 }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={2}
                  sx={{
                    justifyContent: 'space-between',
                    alignItems: { xs: 'flex-start', sm: 'center' },
                    mb: 2,
                  }}
                >
                  <Box>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Typography
                        variant="subtitle1"
                        sx={{ fontWeight: 700, color: '#263451' }}
                      >
                        {group.invoice.id}
                      </Typography>

                      <Chip
                        size="small"
                        label={
                          group.invoice.validation_status ?? 'Not analyzed'
                        }
                        color={validationColor(
                          group.invoice.validation_status
                        )}
                      />

                      <Chip
                        size="small"
                        variant="outlined"
                        label={group.invoice.status.replace(/_/g, ' ')}
                      />
                    </Stack>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.5 }}
                    >
                      {group.invoice.vendor?.legal_name ??
                        'Unknown vendor'}{' '}
                      · {formatMoney(group.invoice)}
                      {group.invoice.invoice_number
                        ? ` · ${group.invoice.invoice_number}`
                        : ''}
                    </Typography>
                  </Box>

                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => onOpenInvoice(group.invoice.id)}
                  >
                    Review invoice
                  </Button>
                </Stack>

                <Divider sx={{ mb: 2 }} />

                <FindingList findings={group.findings} />
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  )
}
