import { useCallback, useEffect, useState } from 'react'

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

import DownloadIcon from '@mui/icons-material/Download'
import RefreshIcon from '@mui/icons-material/Refresh'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'

import {
  auditService,
  type AuditEvent,
  type User,
} from './api/services'

import { describeError, type ErrorPresentation } from './api/errors'

import { canViewAudit } from './auth/permissions'

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function formatDateTime(value: string | null): string {
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

function evidenceText(value: Record<string, unknown> | null): string {
  if (!value || Object.keys(value).length === 0) return '—'
  return JSON.stringify(value, null, 2)
}

// --------------------------------------------------
// PAGE
// --------------------------------------------------

interface AuditProps {
  user: User
  onOpenInvoice: (invoiceId: string) => void
}

export default function Audit({ user, onOpenInvoice }: AuditProps) {
  const [entityType, setEntityType] = useState('ALL')
  const [entityId, setEntityId] = useState('')
  const [actorId, setActorId] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [events, setEvents] = useState<AuditEvent[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ErrorPresentation | null>(null)

  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] =
    useState<ErrorPresentation | null>(null)

  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null)

  const loadEvents = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await auditService.list({
        entity_type: entityType === 'ALL' ? undefined : entityType,
        entity_id: entityId.trim() || undefined,
        actor_id: actorId.trim() || undefined,
        action: action.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        page: page + 1,
        page_size: rowsPerPage,
      })

      setEvents(response.results)
      setCount(response.count)
    } catch (err) {
      setError(describeError(err))
      setEvents([])
      setCount(0)
    } finally {
      setLoading(false)
    }
  }, [
    entityType,
    entityId,
    actorId,
    action,
    from,
    to,
    page,
    rowsPerPage,
  ])

  useEffect(() => {
    async function load() {
      await loadEvents()
    }

    void load()
  }, [loadEvents])

  async function handleExport() {
    setExporting(true)
    setExportError(null)

    try {
      const blob = await auditService.exportCsv({
        entity_type: entityType === 'ALL' ? undefined : entityType,
        entity_id: entityId.trim() || undefined,
        actor_id: actorId.trim() || undefined,
        action: action.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
      })

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'audit_events.csv'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(describeError(err))
    } finally {
      setExporting(false)
    }
  }

  function resetFilters() {
    setEntityType('ALL')
    setEntityId('')
    setActorId('')
    setAction('')
    setFrom('')
    setTo('')
    setPage(0)
  }

  if (!canViewAudit(user.role)) {
    return (
      <Alert severity="info" icon={<LockOutlinedIcon />}>
        The audit trail is available to Controller and Auditor roles only.
      </Alert>
    )
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
                Audit Trail
              </Typography>

              <Typography variant="body2" color="text.secondary">
                Append-only record of every material action. Controller and
                Auditor roles can read and export it.
              </Typography>
            </Box>

            <Stack direction="row" spacing={2}>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                disabled={loading}
                onClick={() => {
                  void loadEvents()
                }}
              >
                Refresh
              </Button>

              <Button
                variant="contained"
                startIcon={<DownloadIcon />}
                disabled={exporting}
                onClick={() => {
                  void handleExport()
                }}
                sx={{
                  backgroundColor: '#404D73',
                  '&:hover': { backgroundColor: '#354263' },
                }}
              >
                {exporting ? 'Exporting...' : 'Export CSV'}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {/* FILTERS */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2.5 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ flexWrap: 'wrap', alignItems: { md: 'center' } }}
          >
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Entity type</InputLabel>

              <Select
                label="Entity type"
                value={entityType}
                onChange={(event) => {
                  setEntityType(event.target.value)
                  setPage(0)
                }}
              >
                <MenuItem value="ALL">All entities</MenuItem>
                <MenuItem value="INVOICE">Invoice</MenuItem>
                <MenuItem value="PAYMENT">Payment</MenuItem>
                <MenuItem value="VENDOR">Vendor</MenuItem>
              </Select>
            </FormControl>

            <TextField
              size="small"
              label="Entity ID"
              value={entityId}
              onChange={(event) => {
                setEntityId(event.target.value)
                setPage(0)
              }}
              sx={{ minWidth: 150 }}
            />

            <TextField
              size="small"
              label="Actor ID"
              value={actorId}
              onChange={(event) => {
                setActorId(event.target.value)
                setPage(0)
              }}
              sx={{ minWidth: 130 }}
            />

            <TextField
              size="small"
              label="Action"
              value={action}
              onChange={(event) => {
                setAction(event.target.value)
                setPage(0)
              }}
              sx={{ minWidth: 180 }}
            />

            <TextField
              size="small"
              label="From"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value)
                setPage(0)
              }}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 150 }}
            />

            <TextField
              size="small"
              label="To"
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value)
                setPage(0)
              }}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 150 }}
            />

            <Button onClick={resetFilters}>Clear</Button>
          </Stack>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 1 }}
          >
            {count} event{count === 1 ? '' : 's'} match the current filters.
          </Typography>
        </CardContent>
      </Card>

      {/* ERRORS */}
      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                void loadEvents()
              }}
            >
              Retry
            </Button>
          }
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Could not load the audit trail ({error.code})
          </Typography>

          <Typography variant="body2">{error.message}</Typography>

          {error.hint && (
            <Typography variant="caption">{error.hint}</Typography>
          )}
        </Alert>
      )}

      {exportError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Export failed ({exportError.code})
          </Typography>

          <Typography variant="body2">{exportError.message}</Typography>

          {exportError.hint && (
            <Typography variant="caption">{exportError.hint}</Typography>
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
              Loading audit events...
            </Typography>
          </Box>
        ) : events.length === 0 ? (
          <Box sx={{ p: 4 }}>
            <Typography sx={{ fontWeight: 600, color: '#263451' }}>
              No audit events match this view.
            </Typography>

            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Clear the filters or perform an action to create an audit event.
            </Typography>
          </Box>
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <TableHead sx={{ backgroundColor: '#E9EDF5' }}>
                  <TableRow>
                    <TableCell>Timestamp</TableCell>
                    <TableCell>Actor</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>Entity</TableCell>
                    <TableCell>Change</TableCell>
                    <TableCell align="right">Details</TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {formatDateTime(event.timestamp)}
                      </TableCell>

                      <TableCell>
                        <Typography variant="body2">
                          {event.actor_name ?? '—'}
                        </Typography>

                        <Typography variant="caption" color="text.secondary">
                          {event.actor_id ?? '—'}
                          {event.on_behalf_of_id
                            ? ` · on behalf of ${event.on_behalf_of_id}`
                            : ''}
                        </Typography>
                      </TableCell>

                      <TableCell>
                        <Chip
                          size="small"
                          label={formatLabel(event.action)}
                          variant="outlined"
                        />
                      </TableCell>

                      <TableCell>
                        <Button
                          size="small"
                          sx={{ textTransform: 'none', p: 0, minWidth: 0 }}
                          disabled={event.entity_type !== 'INVOICE'}
                          onClick={() => onOpenInvoice(event.entity_id)}
                        >
                          {event.entity_type} · {event.entity_id}
                        </Button>
                      </TableCell>

                      <TableCell sx={{ maxWidth: 260 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ overflowWrap: 'anywhere' }}
                        >
                          {event.after && Object.keys(event.after).length > 0
                            ? JSON.stringify(event.after)
                            : '—'}
                        </Typography>
                      </TableCell>

                      <TableCell align="right">
                        <Button
                          size="small"
                          onClick={() => setSelectedEvent(event)}
                        >
                          Details
                        </Button>
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

      {/* DETAILS DIALOG */}
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
              <Typography variant="body2">
                {formatDateTime(selectedEvent.timestamp)} ·{' '}
                {selectedEvent.actor_name ?? '—'} (
                {selectedEvent.actor_id ?? '—'}) ·{' '}
                {selectedEvent.entity_type} · {selectedEvent.entity_id}
              </Typography>

              {(
                [
                  ['Before', selectedEvent.before],
                  ['After', selectedEvent.after],
                  ['Evidence', selectedEvent.evidence],
                ] as const
              ).map(([label, value]) => (
                <Box key={label}>
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, color: '#667085' }}
                  >
                    {label.toUpperCase()}
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
                    {evidenceText(value)}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setSelectedEvent(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
