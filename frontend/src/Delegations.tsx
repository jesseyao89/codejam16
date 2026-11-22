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

import AddIcon from '@mui/icons-material/Add'
import RefreshIcon from '@mui/icons-material/Refresh'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined'
import HistoryIcon from '@mui/icons-material/History'

import {
  delegationService,
  type Delegation,
  type DelegationWritePayload,
  type User,
} from './api/services'

import {
  describeError,
  getFieldErrors,
  type ErrorPresentation,
} from './api/errors'

import {
  canDelegateForOthers,
  canManageDelegations,
  canReadDelegations,
  isActiveUser,
} from './auth/permissions'

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

type DelegationStatus = 'Active' | 'Scheduled' | 'Ended'
type StatusFilter = 'ALL' | DelegationStatus

function statusOf(delegation: Delegation): DelegationStatus {
  if (delegation.active) return 'Active'
  if (delegation.starts_at && new Date(delegation.starts_at) > new Date()) {
    return 'Scheduled'
  }
  return 'Ended'
}

function statusColor(
  status: DelegationStatus
): 'success' | 'info' | 'default' {
  switch (status) {
    case 'Active':
      return 'success'
    case 'Scheduled':
      return 'info'
    default:
      return 'default'
  }
}

function directionOf(
  delegation: Delegation,
  userId: string
): 'Outgoing' | 'Incoming' | 'Other' {
  if (delegation.principal_id === userId) return 'Outgoing'
  if (delegation.delegate_id === userId) return 'Incoming'
  return 'Other'
}

function directionColor(
  direction: 'Outgoing' | 'Incoming' | 'Other'
): 'success' | 'info' | 'default' {
  switch (direction) {
    case 'Outgoing':
      return 'success'
    case 'Incoming':
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

function formatDate(value: string | null): string {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleDateString('en-CA', { dateStyle: 'medium' })
}

function userLabel(id: string | null, currentUserId: string): string {
  if (!id) return '—'
  return id === currentUserId ? `${id} (you)` : id
}

function toIso(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

// --------------------------------------------------
// CREATE DIALOG
// --------------------------------------------------

interface CreateDialogProps {
  open: boolean
  user: User
  onClose: () => void
  onCreated: (delegation: Delegation) => void | Promise<void>
}

function CreateDelegationDialog({
  open,
  user,
  onClose,
  onCreated,
}: CreateDialogProps) {
  const controller = canDelegateForOthers(user.role)

  const [principalId, setPrincipalId] = useState('')
  const [delegateId, setDelegateId] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ErrorPresentation | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(
    {}
  )

  function reset() {
    setPrincipalId('')
    setDelegateId('')
    setStartsAt('')
    setEndsAt('')
    setError(null)
    setFieldErrors({})
  }

  function handleClose() {
    if (saving) return
    reset()
    onClose()
  }

  async function handleSubmit() {
    const nextFieldErrors: Record<string, string> = {}
    const principal = principalId.trim().toUpperCase()
    const delegate = delegateId.trim().toUpperCase()

    if (!delegate) {
      nextFieldErrors.delegate_id = 'A delegate user ID is required.'
    }

    if (principal && delegate && principal === delegate) {
      nextFieldErrors.delegate_id =
        'A principal cannot delegate to themselves.'
    }

    const startIso = toIso(startsAt)
    const endIso = toIso(endsAt)

    if (startsAt && !startIso) {
      nextFieldErrors.starts_at = 'Enter a valid start date and time.'
    }

    if (endsAt && !endIso) {
      nextFieldErrors.ends_at = 'Enter a valid end date and time.'
    }

    if (startIso && endIso && new Date(endIso) <= new Date(startIso)) {
      nextFieldErrors.ends_at = 'End must be after the start.'
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors)
      return
    }

    setFieldErrors({})
    setError(null)
    setSaving(true)

    const payload: DelegationWritePayload = {
      delegate_id: delegate,
      starts_at: startIso,
      ends_at: endIso,
    }

    if (controller && principal) {
      payload.principal_id = principal
    }

    try {
      const created = await delegationService.create(payload)
      reset()
      await onCreated(created)
    } catch (err) {
      setError(describeError(err))
      setFieldErrors(getFieldErrors(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
        New delegation
      </DialogTitle>

      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          An active delegate can decide approval steps assigned to the
          principal. Every decision records the principal in{' '}
          <code>delegated_for_id</code> and the audit trail.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {error.code}
            </Typography>

            <Typography variant="body2">{error.message}</Typography>

            {error.hint && (
              <Typography variant="caption">{error.hint}</Typography>
            )}
          </Alert>
        )}

        <Stack spacing={2} sx={{ mt: 1 }}>
          {controller && (
            <TextField
              fullWidth
              label="Principal user ID"
              value={principalId}
              disabled={saving}
              onChange={(event) => setPrincipalId(event.target.value)}
              error={Boolean(fieldErrors.principal_id)}
              helperText={
                fieldErrors.principal_id ??
                'Leave blank to delegate your own approvals. As a Controller you can name another approver here.'
              }
              autoComplete="off"
            />
          )}

          <TextField
            fullWidth
            required
            label="Delegate user ID"
            value={delegateId}
            disabled={saving}
            onChange={(event) => setDelegateId(event.target.value)}
            error={Boolean(fieldErrors.delegate_id)}
            helperText={
              fieldErrors.delegate_id ??
              'Must be an active Approver, Finance Manager or Controller, e.g. U003.'
            }
            autoComplete="off"
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              fullWidth
              type="datetime-local"
              label="Starts"
              value={startsAt}
              disabled={saving}
              onChange={(event) => setStartsAt(event.target.value)}
              error={Boolean(fieldErrors.starts_at)}
              helperText={
                fieldErrors.starts_at ?? 'Leave blank to start immediately.'
              }
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { step: 300 },
              }}
            />

            <TextField
              fullWidth
              type="datetime-local"
              label="Ends"
              value={endsAt}
              disabled={saving}
              onChange={(event) => setEndsAt(event.target.value)}
              error={Boolean(fieldErrors.ends_at)}
              helperText={
                fieldErrors.ends_at ?? 'Optional. Leave blank to stay open.'
              }
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { step: 300 },
              }}
            />
          </Stack>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ p: 2.5 }}>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>

        <Button
          variant="contained"
          onClick={() => {
            void handleSubmit()
          }}
          disabled={saving}
          sx={{
            backgroundColor: '#404D73',
            '&:hover': { backgroundColor: '#354263' },
          }}
        >
          {saving ? 'Creating...' : 'Create delegation'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// --------------------------------------------------
// PAGE
// --------------------------------------------------

interface DelegationsProps {
  user: User
  onDataChanged: () => void | Promise<void>
}

export default function Delegations({
  user,
  onDataChanged,
}: DelegationsProps) {
  const [delegations, setDelegations] = useState<Delegation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ErrorPresentation | null>(null)

  const [filter, setFilter] = useState<StatusFilter>('ALL')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)

  const [createOpen, setCreateOpen] = useState(false)
  const [ending, setEnding] = useState<Delegation | null>(null)
  const [endLoading, setEndLoading] = useState(false)
  const [endError, setEndError] = useState<ErrorPresentation | null>(null)

  const [notice, setNotice] = useState('')

  const canRead = canReadDelegations(user.role)
  const canWrite = canManageDelegations(user.role)
  const controller = canDelegateForOthers(user.role)
  const accountActive = isActiveUser(user.status)

  const loadDelegations = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await delegationService.listAll()
      setDelegations(response.results)
    } catch (err) {
      setError(describeError(err))
      setDelegations([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canRead) return

    async function load() {
      await loadDelegations()
    }

    void load()
  }, [canRead, loadDelegations])

  if (!canRead) {
    return (
      <Card>
        <CardContent sx={{ p: 4, textAlign: 'center' }}>
          <LockOutlinedIcon sx={{ fontSize: 40, color: '#667085' }} />

          <Typography variant="h6" sx={{ mt: 1, color: '#263451' }}>
            Delegations are not available to your role
          </Typography>

          <Typography variant="body2" color="text.secondary">
            Approvers, Finance Managers, Controllers and Auditors can view
            delegations.
          </Typography>
        </CardContent>
      </Card>
    )
  }

  const counts = {
    Active: delegations.filter((item) => statusOf(item) === 'Active').length,
    Scheduled: delegations.filter(
      (item) => statusOf(item) === 'Scheduled'
    ).length,
    Ended: delegations.filter((item) => statusOf(item) === 'Ended').length,
  }

  const filtered = delegations
    .filter((item) => filter === 'ALL' || statusOf(item) === filter)
    .sort((left, right) => {
      const order: Record<DelegationStatus, number> = {
        Active: 0,
        Scheduled: 1,
        Ended: 2,
      }
      const delta = order[statusOf(left)] - order[statusOf(right)]
      if (delta !== 0) return delta
      return (
        new Date(right.starts_at).getTime() -
        new Date(left.starts_at).getTime()
      )
    })

  const visible = filtered.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  )

  async function handleCreated(created: Delegation) {
    setCreateOpen(false)
    setFilter('ALL')
    setPage(0)
    setNotice(
      `Delegation ${created.id} created: ${created.principal_id} → ${created.delegate_id}.`
    )
    await loadDelegations()
    await onDataChanged()
  }

  async function handleEnd() {
    if (!ending) return

    setEndLoading(true)
    setEndError(null)

    try {
      await delegationService.end(ending.id)
      setNotice(
        `Delegation ${ending.id} ended. History and audit events are kept.`
      )
      setEnding(null)
      setPage(0)
      await loadDelegations()
      await onDataChanged()
    } catch (err) {
      setEndError(describeError(err))
    } finally {
      setEndLoading(false)
    }
  }

  function canEnd(delegation: Delegation): boolean {
    if (!delegation.active) return false
    if (!canWrite || !accountActive) return false
    return controller || delegation.principal_id === user.id
  }

  const writeBlockedReason = !canWrite
    ? 'Auditors can review delegations but cannot create or end them.'
    : !accountActive
      ? 'Your account is not active, so delegation changes are disabled.'
      : null

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
                Approval Delegations
              </Typography>

              <Typography variant="body2" color="text.secondary">
                A dated grant of approval authority. A delegate can decide the
                principal&apos;s steps; the decision is recorded on their
                behalf.
              </Typography>
            </Box>

            <Stack direction="row" spacing={2}>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                disabled={loading}
                onClick={() => {
                  void loadDelegations()
                }}
                sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                Refresh
              </Button>

              {canWrite && (
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  disabled={!accountActive}
                  onClick={() => {
                    setCreateOpen(true)
                  }}
                  sx={{
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    backgroundColor: '#404D73',
                    '&:hover': { backgroundColor: '#354263' },
                  }}
                >
                  New delegation
                </Button>
              )}
            </Stack>
          </Stack>

          {writeBlockedReason && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {writeBlockedReason}
            </Alert>
          )}

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 2 }}
          >
            The API exposes user IDs only, so pairs are shown as
            {' '}U012 → U003. One active delegation is allowed per principal;
            scheduled and ended rows are kept for the audit trail.
          </Typography>
        </CardContent>
      </Card>

      {/* SUMMARY */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ mb: 3 }}>
        {[
          {
            label: 'Active now',
            value: counts.Active,
            color: '#166534',
            icon: <CheckCircleOutlineIcon />,
          },
          {
            label: 'Scheduled',
            value: counts.Scheduled,
            color: '#1D4ED8',
            icon: <AccessTimeIcon />,
          },
          {
            label: 'Ended',
            value: counts.Ended,
            color: '#667085',
            icon: <HistoryIcon />,
          },
        ].map((item) => (
          <Card key={item.label} sx={{ flex: 1 }}>
            <CardContent sx={{ p: 3 }}>
              <Stack
                direction="row"
                sx={{ justifyContent: 'space-between', alignItems: 'center' }}
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
                void loadDelegations()
              }}
            >
              Retry
            </Button>
          }
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Could not load delegations ({error.code})
          </Typography>

          <Typography variant="body2">{error.message}</Typography>

          {error.hint && (
            <Typography variant="caption">{error.hint}</Typography>
          )}
        </Alert>
      )}

      {/* FILTERS */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2, alignItems: { xs: 'stretch', sm: 'center' } }}
      >
        <ToggleButtonGroup
          size="small"
          exclusive
          value={filter}
          onChange={(_event, value: StatusFilter | null) => {
            if (!value) return
            setFilter(value)
            setPage(0)
          }}
        >
          <ToggleButton value="ALL">All</ToggleButton>
          <ToggleButton value="Active">Active</ToggleButton>
          <ToggleButton value="Scheduled">Scheduled</ToggleButton>
          <ToggleButton value="Ended">Ended</ToggleButton>
        </ToggleButtonGroup>

        <Typography variant="caption" color="text.secondary">
          {filtered.length} delegation{filtered.length === 1 ? '' : 's'} in
          this view.
        </Typography>
      </Stack>

      {/* TABLE */}
      <Card>
        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 4 }}>
            <CircularProgress size={22} />

            <Typography color="text.secondary">
              Loading delegations...
            </Typography>
          </Box>
        ) : visible.length === 0 ? (
          <Box sx={{ p: 4 }}>
            <Typography sx={{ fontWeight: 600, color: '#263451' }}>
              {error
                ? 'Delegations could not be loaded.'
                : delegations.length === 0
                  ? 'No delegations recorded yet.'
                  : 'No delegations match this filter.'}
            </Typography>

            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {error
                ? 'Use Retry above to try again.'
                : delegations.length === 0 && canWrite
                  ? 'Create one to hand your approval queue to a colleague while you are away.'
                  : 'Choose another status filter.'}
            </Typography>
          </Box>
        ) : (
          <>
            <TableContainer>
              <Table size="small" sx={{ minWidth: 900 }}>
                <TableHead sx={{ backgroundColor: '#E9EDF5' }}>
                  <TableRow>
                    <TableCell>Delegation</TableCell>
                    <TableCell>Principal</TableCell>
                    <TableCell>Delegate</TableCell>
                    <TableCell>Period</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Direction</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {visible.map((delegation) => {
                    const status = statusOf(delegation)
                    const direction = directionOf(delegation, user.id)

                    return (
                      <TableRow key={delegation.id} hover>
                        <TableCell>
                          <Typography
                            variant="body2"
                            sx={{ fontFamily: 'monospace' }}
                          >
                            {delegation.id}
                          </Typography>
                        </TableCell>

                        <TableCell>
                          <Typography variant="body2">
                            {userLabel(delegation.principal_id, user.id)}
                          </Typography>
                        </TableCell>

                        <TableCell>
                          <Typography variant="body2">
                            {userLabel(delegation.delegate_id, user.id)}
                          </Typography>
                        </TableCell>

                        <TableCell>
                          <Typography variant="body2">
                            {formatDate(delegation.starts_at)}
                          </Typography>

                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            {delegation.ends_at
                              ? `to ${formatDateTime(delegation.ends_at)}`
                              : 'open-ended'}
                          </Typography>
                        </TableCell>

                        <TableCell>
                          <Chip
                            size="small"
                            label={status}
                            color={statusColor(status)}
                            sx={{ fontWeight: 600 }}
                          />
                        </TableCell>

                        <TableCell>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={direction}
                            color={directionColor(direction)}
                          />
                        </TableCell>

                        <TableCell align="right">
                          {canEnd(delegation) ? (
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={() => {
                                setEndError(null)
                                setEnding(delegation)
                              }}
                            >
                              End
                            </Button>
                          ) : (
                            <Typography
                              variant="caption"
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
              count={filtered.length}
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

      {/* CREATE DIALOG */}
      <CreateDelegationDialog
        open={createOpen}
        user={user}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />

      {/* END CONFIRMATION */}
      <Dialog
        open={ending !== null}
        onClose={() => {
          if (!endLoading) setEnding(null)
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
          End this delegation?
        </DialogTitle>

        <DialogContent>
          {ending && (
            <>
              <Typography variant="body2">
                {ending.principal_id} → {ending.delegate_id}
              </Typography>

              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                The delegate will lose approval authority immediately. The
                delegation and its audit events are kept for history; a new
                delegation must be created to restore cover.
              </Typography>

              {endError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {endError.code}
                  </Typography>

                  <Typography variant="body2">{endError.message}</Typography>

                  {endError.hint && (
                    <Typography variant="caption">
                      {endError.hint}
                    </Typography>
                  )}
                </Alert>
              )}
            </>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2.5 }}>
          <Button
            onClick={() => setEnding(null)}
            disabled={endLoading}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            color="error"
            onClick={() => {
              void handleEnd()
            }}
            disabled={endLoading}
          >
            {endLoading ? 'Ending...' : 'End delegation'}
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
