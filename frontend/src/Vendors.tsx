import {
  useCallback,
  useEffect,
  useRef,
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
  Drawer,
  IconButton,
  MenuItem,
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

import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import EditIcon from '@mui/icons-material/Edit'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'

import {
  vendorService,
  type BankChange,
  type User,
  type VendorDetail,
  type VendorWritePayload,
} from './api/services'

import {
  describeError,
  getFieldErrors,
  type ErrorPresentation,
} from './api/errors'

import {
  canManageVendors,
  canReadVendorBankChanges,
  canRequestBankChange,
  isActiveUser,
} from './auth/permissions'

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

type StatusFilter = 'ALL' | 'active' | 'on_hold' | 'pending_review'
type VendorFormMode = 'create' | 'edit'

interface VendorSummary {
  total: number
  active: number
  onHold: number
  pendingReview: number
}

interface VendorFormValues {
  legal_name: string
  category: string
  default_gl_account: string
  address: string
  province_or_state: string
  country: string
  gst_hst_number: string
  qst_number: string
  payment_terms_days: string
  early_pay_discount: string
  preferred_payment_method: string
  accepts_card_payment: string
  requires_po: string
  ap_contact_email: string
}

type ConfirmAction =
  | { kind: 'approve' }
  | { kind: 'hold' }
  | { kind: 'unhold' }
  | { kind: 'bank-approve'; change: BankChange }
  | { kind: 'bank-reject'; change: BankChange }

const PAYMENT_METHODS = ['EFT', 'CARD', 'CHEQUE']

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
    case 'APPROVED':
      return 'success'
    case 'PENDING':
      return 'warning'
    case 'REJECTED':
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

function formatDateTime(value: string | null): string {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatLabel(value: string | null): string {
  return value ? value.replace(/_/g, ' ') : '—'
}

function formatBankStatus(status: string | null): string {
  if (!status) return 'Not tracked'
  return status.charAt(0) + status.slice(1).toLowerCase()
}

function isYes(value: string): boolean {
  return ['yes', 'y', 'true', '1'].includes(value.trim().toLowerCase())
}

function choiceOptions(
  value: string
): Array<{ value: string; label: string }> {
  const options = [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ]

  if (value && value !== 'yes' && value !== 'no') {
    options.push({ value, label: `${value} (current)` })
  }

  return options
}

function emptyFormValues(): VendorFormValues {
  return {
    legal_name: '',
    category: '',
    default_gl_account: '',
    address: '',
    province_or_state: '',
    country: '',
    gst_hst_number: '',
    qst_number: '',
    payment_terms_days: '',
    early_pay_discount: '',
    preferred_payment_method: 'EFT',
    accepts_card_payment: 'no',
    requires_po: 'no',
    ap_contact_email: '',
  }
}

function vendorToFormValues(
  vendor: VendorDetail | null | undefined
): VendorFormValues {
  if (!vendor) return emptyFormValues()

  return {
    legal_name: vendor.legal_name,
    category: vendor.category,
    default_gl_account: vendor.default_gl_account ?? '',
    address: vendor.address,
    province_or_state: vendor.province_or_state,
    country: vendor.country,
    gst_hst_number: vendor.gst_hst_number,
    qst_number: vendor.qst_number,
    payment_terms_days:
      vendor.payment_terms_days !== null &&
      vendor.payment_terms_days !== undefined
        ? String(vendor.payment_terms_days)
        : '',
    early_pay_discount: vendor.early_pay_discount,
    preferred_payment_method: vendor.preferred_payment_method || 'EFT',
    accepts_card_payment: vendor.accepts_card_payment || 'no',
    requires_po: vendor.requires_po || 'no',
    ap_contact_email: vendor.ap_contact_email,
  }
}

function buildVendorPayload(values: VendorFormValues): {
  payload: VendorWritePayload
  errors: Record<string, string>
} {
  const errors: Record<string, string> = {}
  const legalName = values.legal_name.trim()

  if (!legalName) {
    errors.legal_name = 'Legal name is required.'
  }

  const province = values.province_or_state.trim().toUpperCase()
  const country = values.country.trim().toUpperCase()

  if (province.length > 2) {
    errors.province_or_state = 'Use a 2-letter province/state code.'
  }

  if (country.length > 2) {
    errors.country = 'Use a 2-letter country code.'
  }

  const termsText = values.payment_terms_days.trim()
  let paymentTerms: number | null = null

  if (termsText) {
    if (!/^\d+$/.test(termsText)) {
      errors.payment_terms_days = 'Enter a whole number of days (0 or more).'
    } else {
      paymentTerms = Number(termsText)
    }
  }

  return {
    errors,
    payload: {
      legal_name: legalName,
      category: values.category.trim(),
      default_gl_account: values.default_gl_account.trim(),
      address: values.address.trim(),
      province_or_state: province,
      country,
      gst_hst_number: values.gst_hst_number.trim(),
      qst_number: values.qst_number.trim(),
      payment_terms_days: paymentTerms,
      early_pay_discount: values.early_pay_discount.trim(),
      preferred_payment_method: values.preferred_payment_method,
      accepts_card_payment: values.accepts_card_payment,
      requires_po: values.requires_po,
      ap_contact_email: values.ap_contact_email.trim(),
    },
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
        sx={{ minWidth: 150, flexShrink: 0 }}
      >
        {label}
      </Typography>

      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Stack>
  )
}

// --------------------------------------------------
// VENDOR FORM
// --------------------------------------------------

function VendorFormDialog({
  mode,
  vendor,
  onClose,
  onSaved,
}: {
  mode: VendorFormMode
  vendor?: VendorDetail | null
  onClose: () => void
  onSaved: (vendor: VendorDetail) => void | Promise<void>
}) {
  const [values, setValues] = useState<VendorFormValues>(() =>
    vendorToFormValues(vendor)
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(
    {}
  )
  const [error, setError] = useState<ErrorPresentation | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  function setValue(field: keyof VendorFormValues, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }))
  }

  async function handleSubmit() {
    if (savingRef.current) return

    const { payload, errors } = buildVendorPayload(values)

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    savingRef.current = true
    setSaving(true)
    setError(null)
    setFieldErrors({})

    try {
      const saved =
        mode === 'create'
          ? await vendorService.create(payload)
          : await vendorService.update(vendor?.id ?? '', payload)

      await onSaved(saved)
      onClose()
    } catch (err) {
      setError(describeError(err))
      setFieldErrors(getFieldErrors(err))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const preferredMethods = PAYMENT_METHODS.includes(
    values.preferred_payment_method
  )
    ? PAYMENT_METHODS
    : [...PAYMENT_METHODS, values.preferred_payment_method].filter(Boolean)

  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) onClose()
      }}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
        {mode === 'create' ? 'Onboard vendor' : 'Edit vendor'}
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          {error && (
            <Alert severity="error">
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {error.code}
              </Typography>

              <Typography variant="body2">{error.message}</Typography>

              {error.hint && (
                <Typography variant="caption">{error.hint}</Typography>
              )}
            </Alert>
          )}

          {mode === 'edit' && (
            <Alert severity="info">
              Bank details are never edited here. Use a controlled bank-change
              request so the change can be independently approved.
            </Alert>
          )}

          <TextField
            fullWidth
            required
            label="Legal name"
            value={values.legal_name}
            disabled={saving}
            error={Boolean(fieldErrors.legal_name)}
            helperText={fieldErrors.legal_name}
            onChange={(event) => setValue('legal_name', event.target.value)}
          />

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: 'flex-start' }}
          >
            <TextField
              fullWidth
              label="Category"
              value={values.category}
              disabled={saving}
              error={Boolean(fieldErrors.category)}
              helperText={fieldErrors.category}
              onChange={(event) => setValue('category', event.target.value)}
            />

            <TextField
              fullWidth
              label="Default GL account"
              value={values.default_gl_account}
              disabled={saving}
              error={Boolean(fieldErrors.default_gl_account)}
              helperText={
                fieldErrors.default_gl_account || 'Account number, e.g. 5010'
              }
              onChange={(event) =>
                setValue('default_gl_account', event.target.value)
              }
            />
          </Stack>

          <TextField
            fullWidth
            label="Address"
            value={values.address}
            disabled={saving}
            error={Boolean(fieldErrors.address)}
            helperText={fieldErrors.address}
            onChange={(event) => setValue('address', event.target.value)}
          />

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: 'flex-start' }}
          >
            <TextField
              fullWidth
              label="Province / state"
              value={values.province_or_state}
              disabled={saving}
              error={Boolean(fieldErrors.province_or_state)}
              helperText={fieldErrors.province_or_state || '2 letters'}
              slotProps={{ htmlInput: { maxLength: 2 } }}
              onChange={(event) =>
                setValue('province_or_state', event.target.value)
              }
            />

            <TextField
              fullWidth
              label="Country"
              value={values.country}
              disabled={saving}
              error={Boolean(fieldErrors.country)}
              helperText={fieldErrors.country || '2 letters'}
              slotProps={{ htmlInput: { maxLength: 2 } }}
              onChange={(event) => setValue('country', event.target.value)}
            />
          </Stack>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: 'flex-start' }}
          >
            <TextField
              fullWidth
              label="GST / HST number"
              value={values.gst_hst_number}
              disabled={saving}
              error={Boolean(fieldErrors.gst_hst_number)}
              helperText={fieldErrors.gst_hst_number}
              onChange={(event) =>
                setValue('gst_hst_number', event.target.value)
              }
            />

            <TextField
              fullWidth
              label="QST number"
              value={values.qst_number}
              disabled={saving}
              error={Boolean(fieldErrors.qst_number)}
              helperText={fieldErrors.qst_number}
              onChange={(event) => setValue('qst_number', event.target.value)}
            />
          </Stack>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: 'flex-start' }}
          >
            <TextField
              fullWidth
              label="Payment terms (days)"
              type="number"
              value={values.payment_terms_days}
              disabled={saving}
              error={Boolean(fieldErrors.payment_terms_days)}
              helperText={fieldErrors.payment_terms_days}
              slotProps={{ htmlInput: { min: 0 } }}
              onChange={(event) =>
                setValue('payment_terms_days', event.target.value)
              }
            />

            <TextField
              fullWidth
              label="Early-pay discount"
              value={values.early_pay_discount}
              disabled={saving}
              error={Boolean(fieldErrors.early_pay_discount)}
              helperText={fieldErrors.early_pay_discount}
              onChange={(event) =>
                setValue('early_pay_discount', event.target.value)
              }
            />
          </Stack>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: 'flex-start' }}
          >
            <TextField
              fullWidth
              select
              label="Preferred payment method"
              value={values.preferred_payment_method}
              disabled={saving}
              error={Boolean(fieldErrors.preferred_payment_method)}
              helperText={fieldErrors.preferred_payment_method}
              onChange={(event) =>
                setValue('preferred_payment_method', event.target.value)
              }
            >
              {preferredMethods.map((method) => (
                <MenuItem key={method} value={method}>
                  {method}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              fullWidth
              select
              label="Accepts card payment"
              value={values.accepts_card_payment}
              disabled={saving}
              error={Boolean(fieldErrors.accepts_card_payment)}
              helperText={fieldErrors.accepts_card_payment}
              onChange={(event) =>
                setValue('accepts_card_payment', event.target.value)
              }
            >
              {choiceOptions(values.accepts_card_payment).map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: 'flex-start' }}
          >
            <TextField
              fullWidth
              select
              label="Requires purchase order"
              value={values.requires_po}
              disabled={saving}
              error={Boolean(fieldErrors.requires_po)}
              helperText={fieldErrors.requires_po}
              onChange={(event) =>
                setValue('requires_po', event.target.value)
              }
            >
              {choiceOptions(values.requires_po).map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              fullWidth
              label="AP contact email"
              value={values.ap_contact_email}
              disabled={saving}
              error={Boolean(fieldErrors.ap_contact_email)}
              helperText={fieldErrors.ap_contact_email}
              onChange={(event) =>
                setValue('ap_contact_email', event.target.value)
              }
            />
          </Stack>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ p: 2.5 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>

        <Button
          variant="contained"
          disabled={saving}
          onClick={() => {
            void handleSubmit()
          }}
          sx={{
            backgroundColor: '#404D73',
            '&:hover': { backgroundColor: '#354263' },
          }}
        >
          {saving
            ? 'Saving...'
            : mode === 'create'
              ? 'Onboard vendor'
              : 'Save changes'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// --------------------------------------------------
// BANK CHANGE REQUEST
// --------------------------------------------------

function BankChangeDialog({
  vendor,
  onClose,
  onSaved,
}: {
  vendor: VendorDetail
  onClose: () => void
  onSaved: (change: BankChange) => void | Promise<void>
}) {
  const [account, setAccount] = useState('')
  const [note, setNote] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [error, setError] = useState<ErrorPresentation | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  async function handleSubmit() {
    if (savingRef.current) return

    const normalized = account.replace(/[\s-]/g, '')

    if (!/^\d{4,32}$/.test(normalized)) {
      setFieldError('Enter a 4–32 digit account number.')
      return
    }

    savingRef.current = true
    setSaving(true)
    setError(null)
    setFieldError('')

    try {
      const change = await vendorService.requestBankChange(vendor.id, {
        bank_account: normalized,
        note: note.trim() || undefined,
      })

      await onSaved(change)
      onClose()
    } catch (err) {
      setError(describeError(err))
      setFieldError(getFieldErrors(err).bank_account ?? '')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) onClose()
      }}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
        Request bank change
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2">
            Vendor: <strong>{vendor.legal_name}</strong> ({vendor.id})
          </Typography>

          <Typography variant="body2" color="text.secondary">
            Current account: {vendor.bank_account_masked ?? 'Not captured'}
          </Typography>

          <Alert severity="info">
            This creates a PENDING change. A Finance Manager or Controller must
            approve it before the vendor bank account is updated. Only one
            change can be pending per vendor.
          </Alert>

          {error && (
            <Alert severity="error">
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {error.code}
              </Typography>

              <Typography variant="body2">{error.message}</Typography>

              {error.hint && (
                <Typography variant="caption">{error.hint}</Typography>
              )}
            </Alert>
          )}

          <TextField
            fullWidth
            required
            label="New bank account"
            value={account}
            disabled={saving}
            error={Boolean(fieldError)}
            helperText={
              fieldError || '4–32 digits; spaces and dashes are ignored.'
            }
            onChange={(event) => setAccount(event.target.value)}
          />

          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Note"
            value={note}
            disabled={saving}
            helperText="Optional context for the approver (max 255 characters)."
            slotProps={{ htmlInput: { maxLength: 255 } }}
            onChange={(event) => setNote(event.target.value)}
          />
        </Stack>
      </DialogContent>

      <DialogActions sx={{ p: 2.5 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>

        <Button
          variant="contained"
          disabled={saving}
          onClick={() => {
            void handleSubmit()
          }}
          sx={{
            backgroundColor: '#404D73',
            '&:hover': { backgroundColor: '#354263' },
          }}
        >
          {saving ? 'Requesting...' : 'Request bank change'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// --------------------------------------------------
// CONFIRMATION
// --------------------------------------------------

function ConfirmDialog({
  open,
  title,
  confirmLabel,
  destructive,
  loading,
  error,
  onCancel,
  onConfirm,
  children,
}: {
  open: boolean
  title: string
  confirmLabel: string
  destructive?: boolean
  loading: boolean
  error: ErrorPresentation | null
  onCancel: () => void
  onConfirm: () => void
  children: ReactNode
}) {
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!loading) onCancel()
      }}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
        {title}
      </DialogTitle>

      <DialogContent dividers>
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

        {children}
      </DialogContent>

      <DialogActions sx={{ p: 2.5 }}>
        <Button onClick={onCancel} disabled={loading}>
          Cancel
        </Button>

        <Button
          variant="contained"
          color={destructive ? 'error' : 'primary'}
          disabled={loading}
          onClick={onConfirm}
          sx={
            destructive
              ? undefined
              : {
                  backgroundColor: '#404D73',
                  '&:hover': { backgroundColor: '#354263' },
                }
          }
        >
          {loading ? 'Working...' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// --------------------------------------------------
// VENDOR DETAIL
// --------------------------------------------------

function VendorDetailDrawer({
  vendorId,
  user,
  onClose,
  onChanged,
  onNotice,
}: {
  vendorId: string
  user: User
  onClose: () => void
  onChanged: () => void | Promise<void>
  onNotice: (message: string) => void
}) {
  const canManage =
    canManageVendors(user.role) && isActiveUser(user.status)
  const canRequest =
    canRequestBankChange(user.role) && isActiveUser(user.status)
  const canReadBankChanges = canReadVendorBankChanges(user.role)

  const [vendor, setVendor] = useState<VendorDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ErrorPresentation | null>(null)
  const [vendorReloadToken, setVendorReloadToken] = useState(0)

  const [bankChanges, setBankChanges] = useState<BankChange[]>([])
  const [bankLoading, setBankLoading] = useState(canReadBankChanges)
  const [bankError, setBankError] = useState<ErrorPresentation | null>(null)
  const [bankReloadToken, setBankReloadToken] = useState(0)

  const [editOpen, setEditOpen] = useState(false)
  const [bankChangeOpen, setBankChangeOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(
    null
  )
  const [confirmLoading, setConfirmLoading] = useState(false)
  const confirmRef = useRef(false)
  const [confirmError, setConfirmError] =
    useState<ErrorPresentation | null>(null)

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
    if (!canReadBankChanges) return

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
  }, [vendorId, bankReloadToken, canReadBankChanges])

  function refreshVendor() {
    setLoading(true)
    setError(null)
    setVendorReloadToken((token) => token + 1)
  }

  function refreshBankChanges() {
    if (!canReadBankChanges) return
    setBankLoading(true)
    setBankError(null)
    setBankReloadToken((token) => token + 1)
  }

  async function handleVendorSaved(updated: VendorDetail) {
    setVendor(updated)
    setEditOpen(false)
    onNotice(`Vendor ${updated.id} updated.`)
    await onChanged()
  }

  async function handleBankChangeSaved(change: BankChange) {
    setBankChangeOpen(false)
    onNotice(
      `Bank change ${change.id} requested (**** ${change.new_account_last4 ?? '????'}). Awaiting approval.`
    )
    refreshVendor()
    refreshBankChanges()
    await onChanged()
  }

  function openConfirm(action: ConfirmAction) {
    setConfirmError(null)
    setConfirmAction(action)
  }

  async function handleConfirm() {
    if (confirmRef.current || !confirmAction || !vendor) return

    confirmRef.current = true
    setConfirmLoading(true)
    setConfirmError(null)

    try {
      if (confirmAction.kind === 'approve') {
        const updated = await vendorService.approve(vendor.id)
        setVendor(updated)
        onNotice(`Vendor ${updated.id} approved.`)
      } else if (confirmAction.kind === 'hold') {
        const updated = await vendorService.hold(vendor.id)
        setVendor(updated)
        onNotice(`Vendor ${updated.id} put on hold.`)
      } else if (confirmAction.kind === 'unhold') {
        const updated = await vendorService.unhold(vendor.id)
        setVendor(updated)
        onNotice(`Vendor ${updated.id} released from hold.`)
      } else {
        const decision =
          confirmAction.kind === 'bank-approve' ? 'approve' : 'reject'
        const change =
          decision === 'approve'
            ? await vendorService.approveBankChange(
                vendor.id,
                confirmAction.change.id
              )
            : await vendorService.rejectBankChange(
                vendor.id,
                confirmAction.change.id
              )

        onNotice(
          `Bank change ${change.id} ${
            decision === 'approve' ? 'approved' : 'rejected'
          }.`
        )
        refreshVendor()
        refreshBankChanges()
      }

      setConfirmAction(null)
      await onChanged()
    } catch (err) {
      setConfirmError(describeError(err))
    } finally {
      confirmRef.current = false
      setConfirmLoading(false)
    }
  }

  const pendingChange = vendor?.pending_bank_change ?? null
  const canDecidePending =
    canManage &&
    pendingChange !== null &&
    pendingChange.requested_by_id !== user.id

  const confirmTitle =
    confirmAction?.kind === 'approve'
      ? 'Approve vendor'
      : confirmAction?.kind === 'hold'
        ? 'Put vendor on hold'
        : confirmAction?.kind === 'unhold'
          ? 'Release vendor hold'
          : confirmAction?.kind === 'bank-approve'
            ? 'Approve bank change'
            : 'Reject bank change'

  const confirmLabel =
    confirmAction?.kind === 'approve'
      ? 'Approve vendor'
      : confirmAction?.kind === 'hold'
        ? 'Put on hold'
        : confirmAction?.kind === 'unhold'
          ? 'Release hold'
          : confirmAction?.kind === 'bank-approve'
            ? 'Approve change'
            : 'Reject change'

  const confirmDestructive =
    confirmAction?.kind === 'bank-reject' ||
    confirmAction?.kind === 'hold'

  return (
    <Drawer
      anchor="right"
      open
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100%', sm: 760 },
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
            <Box sx={{ minWidth: 0 }}>
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
          {loading && !vendor && (
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
                <Button color="inherit" size="small" onClick={refreshVendor}>
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
              <Stack
                direction="row"
                spacing={1}
                sx={{ flexWrap: 'wrap', alignItems: 'center' }}
              >
                <Chip
                  label={formatLabel(vendor.status)}
                  color={vendorStatusColor(vendor.status)}
                  sx={{ fontWeight: 700 }}
                />

                {isYes(vendor.requires_po) && (
                  <Chip size="small" variant="outlined" label="PO required" />
                )}

                {isYes(vendor.accepts_card_payment) && (
                  <Chip size="small" variant="outlined" label="Accepts card" />
                )}

                {vendor.pending_bank_change && (
                  <Chip
                    size="small"
                    color="warning"
                    variant="outlined"
                    label="Bank change pending"
                  />
                )}
              </Stack>

              <Stack
                direction="row"
                spacing={1}
                sx={{ flexWrap: 'wrap' }}
              >
                {canManage && vendor.status === 'pending_review' && (
                  <Button
                    variant="contained"
                    onClick={() => openConfirm({ kind: 'approve' })}
                    sx={{
                      backgroundColor: '#2E7D4F',
                      '&:hover': { backgroundColor: '#24643F' },
                    }}
                  >
                    Approve vendor
                  </Button>
                )}

                {canManage && vendor.status === 'active' && (
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={() => openConfirm({ kind: 'hold' })}
                  >
                    Put on hold
                  </Button>
                )}

                {canManage && vendor.status === 'on_hold' && (
                  <Button
                    variant="contained"
                    onClick={() => openConfirm({ kind: 'unhold' })}
                    sx={{
                      backgroundColor: '#404D73',
                      '&:hover': { backgroundColor: '#354263' },
                    }}
                  >
                    Release hold
                  </Button>
                )}

                {canManage && (
                  <Button
                    variant="outlined"
                    startIcon={<EditIcon />}
                    onClick={() => setEditOpen(true)}
                  >
                    Edit vendor
                  </Button>
                )}

                {canRequest && !pendingChange && (
                  <Button
                    variant="outlined"
                    onClick={() => setBankChangeOpen(true)}
                  >
                    Request bank change
                  </Button>
                )}
              </Stack>

              {!isActiveUser(user.status) && (
                <Alert severity="info" icon={<LockOutlinedIcon />}>
                  Your account is not active. You can review vendor data but
                  cannot change it.
                </Alert>
              )}

              <Box>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: '#667085' }}
                >
                  CONTACT & ADDRESS
                </Typography>

                <DetailRow label="Legal name">
                  <Typography variant="body2">{vendor.legal_name}</Typography>
                </DetailRow>

                <DetailRow label="Address">
                  <Typography variant="body2">
                    {vendor.address || '—'}
                  </Typography>
                </DetailRow>

                <DetailRow label="Province / state">
                  <Typography variant="body2">
                    {vendor.province_or_state || '—'}
                  </Typography>
                </DetailRow>

                <DetailRow label="Country">
                  <Typography variant="body2">
                    {vendor.country || '—'}
                  </Typography>
                </DetailRow>

                <DetailRow label="AP contact">
                  <Typography
                    variant="body2"
                    sx={{ overflowWrap: 'anywhere' }}
                  >
                    {vendor.ap_contact_email || '—'}
                  </Typography>
                </DetailRow>
              </Box>

              <Box>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: '#667085' }}
                >
                  FINANCIAL TERMS
                </Typography>

                <DetailRow label="Payment terms">
                  <Typography variant="body2">
                    {vendor.payment_terms_days !== null
                      ? `${vendor.payment_terms_days} days`
                      : '—'}
                  </Typography>
                </DetailRow>

                <DetailRow label="Preferred method">
                  <Typography variant="body2">
                    {vendor.preferred_payment_method || '—'}
                  </Typography>
                </DetailRow>

                <DetailRow label="Early-pay discount">
                  <Typography variant="body2">
                    {vendor.early_pay_discount || '—'}
                  </Typography>
                </DetailRow>

                <DetailRow label="Default GL account">
                  <Typography variant="body2">
                    {vendor.default_gl_account || '—'}
                  </Typography>
                </DetailRow>

                <DetailRow label="Onboarded">
                  <Typography variant="body2">
                    {formatDate(vendor.onboarded_at)}
                  </Typography>
                </DetailRow>
              </Box>

              <Box>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: '#667085' }}
                >
                  BANK DETAILS (MASKED)
                </Typography>

                <DetailRow label="Account">
                  <Typography variant="body2">
                    {vendor.bank_account_masked ?? 'Not captured'}
                  </Typography>
                </DetailRow>

                <DetailRow label="Institution">
                  <Typography variant="body2">
                    {vendor.bank_institution ?? 'Not captured'}
                  </Typography>
                </DetailRow>

                <DetailRow label="Last updated">
                  <Typography variant="body2">
                    {formatDate(vendor.bank_details_updated_at)}
                  </Typography>
                </DetailRow>
              </Box>

              <Divider />

              <Box>
                <Typography
                  sx={{ fontWeight: 700, color: '#263451', mb: 1 }}
                >
                  Pending bank change
                </Typography>

                {!canReadBankChanges && (
                  <Alert severity="info" icon={<LockOutlinedIcon />}>
                    Bank-change history is available to AP Clerk, Finance
                    Manager, Controller and Auditor roles.
                  </Alert>
                )}

                {canReadBankChanges && !pendingChange && (
                  <Typography variant="body2" color="text.secondary">
                    No pending bank change.
                  </Typography>
                )}

                {canReadBankChanges && pendingChange && (
                  <Box
                    sx={{
                      border: '1px solid #E5E7EB',
                      borderRadius: 1,
                      p: 2,
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        mb: 1,
                      }}
                    >
                      <Chip
                        label={formatBankStatus(pendingChange.status)}
                        color={bankChangeColor(pendingChange.status)}
                        sx={{ fontWeight: 700 }}
                      />

                      <Typography variant="caption" color="text.secondary">
                        Requested {formatDate(pendingChange.changed_at)}
                      </Typography>
                    </Stack>

                    <DetailRow label="Account change">
                      <Typography variant="body2">
                        **** {pendingChange.old_account_last4 || '????'} → ****{' '}
                        {pendingChange.new_account_last4 || '????'}
                      </Typography>
                    </DetailRow>

                    <DetailRow label="Requested by">
                      <Typography variant="body2">
                        {pendingChange.requested_by_id ?? '—'}
                      </Typography>
                    </DetailRow>

                    <DetailRow label="Note">
                      <Typography variant="body2">
                        {pendingChange.note || '—'}
                      </Typography>
                    </DetailRow>

                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ mt: 1.5, flexWrap: 'wrap' }}
                    >
                      {canDecidePending ? (
                        <>
                          <Button
                            variant="contained"
                            onClick={() =>
                              openConfirm({
                                kind: 'bank-approve',
                                change: pendingChange,
                              })
                            }
                            sx={{
                              backgroundColor: '#2E7D4F',
                              '&:hover': { backgroundColor: '#24643F' },
                            }}
                          >
                            Approve change
                          </Button>

                          <Button
                            variant="outlined"
                            color="error"
                            onClick={() =>
                              openConfirm({
                                kind: 'bank-reject',
                                change: pendingChange,
                              })
                            }
                          >
                            Reject change
                          </Button>
                        </>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {pendingChange.requested_by_id === user.id
                            ? 'You requested this change; a different Finance Manager or Controller must decide it.'
                            : 'A Finance Manager or Controller must decide this change.'}
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                )}
              </Box>

              <Box>
                <Typography
                  sx={{ fontWeight: 700, color: '#263451', mb: 1 }}
                >
                  Bank-change history
                </Typography>

                {!canReadBankChanges ? (
                  <Typography variant="body2" color="text.secondary">
                    Restricted for your role.
                  </Typography>
                ) : bankLoading ? (
                  <Box
                    sx={{ display: 'flex', alignItems: 'center', gap: 2 }}
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
                        onClick={refreshBankChanges}
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
                            Account
                          </TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>
                            Status
                          </TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>
                            Decision
                          </TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>
                            Note
                          </TableCell>
                        </TableRow>
                      </TableHead>

                      <TableBody>
                        {bankChanges.map((change) => (
                          <TableRow key={change.id}>
                            <TableCell>
                              {change.id}

                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block' }}
                              >
                                {formatLabel(change.request_channel)} ·
                                callback {formatLabel(change.verified_by_callback)}
                              </Typography>
                            </TableCell>

                            <TableCell>
                              {formatDate(change.changed_at)}
                            </TableCell>

                            <TableCell>
                              **** {change.old_account_last4 || '????'} → ****{' '}
                              {change.new_account_last4 || '????'}
                            </TableCell>

                            <TableCell>
                              <Chip
                                size="small"
                                label={formatBankStatus(change.status)}
                                color={bankChangeColor(change.status)}
                                variant="outlined"
                              />
                            </TableCell>

                            <TableCell>
                              {change.decided_by_id
                                ? `${change.decided_by_id} · ${formatDateTime(
                                    change.decided_at
                                  )}`
                                : '—'}
                            </TableCell>

                            <TableCell>
                              <Typography
                                variant="caption"
                                sx={{ overflowWrap: 'anywhere' }}
                              >
                                {change.note || '—'}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Box>

              {canManage || canRequest ? null : (
                <Alert severity="info" icon={<LockOutlinedIcon />}>
                  Your role can review this vendor but cannot change lifecycle,
                  master data or bank details.
                </Alert>
              )}
            </Stack>
          )}
        </Box>

        <Box
          sx={{
            px: 4,
            py: 2,
            borderTop: '1px solid #E5E7EB',
            backgroundColor: '#FFFFFF',
          }}
        >
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Button onClick={onClose} sx={{ color: '#404D73' }}>
              Close
            </Button>
          </Stack>
        </Box>
      </Box>

      {editOpen && vendor && (
        <VendorFormDialog
          mode="edit"
          vendor={vendor}
          onClose={() => setEditOpen(false)}
          onSaved={handleVendorSaved}
        />
      )}

      {bankChangeOpen && vendor && (
        <BankChangeDialog
          vendor={vendor}
          onClose={() => setBankChangeOpen(false)}
          onSaved={handleBankChangeSaved}
        />
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmTitle}
        confirmLabel={confirmLabel}
        destructive={confirmDestructive}
        loading={confirmLoading}
        error={confirmError}
        onCancel={() => {
          if (!confirmLoading) setConfirmAction(null)
        }}
        onConfirm={() => {
          void handleConfirm()
        }}
      >
        {confirmAction?.kind === 'approve' && (
          <Typography variant="body2">
            Approve {vendorId} and move it from pending review to active?
          </Typography>
        )}

        {confirmAction?.kind === 'hold' && (
          <Typography variant="body2">
            Put {vendorId} on hold? New invoices from this vendor will be
            blocked until the hold is released.
          </Typography>
        )}

        {confirmAction?.kind === 'unhold' && (
          <Typography variant="body2">
            Release {vendorId} from hold and return it to active?
          </Typography>
        )}

        {(confirmAction?.kind === 'bank-approve' ||
          confirmAction?.kind === 'bank-reject') && (
          <>
            <Typography variant="body2">
              Change {confirmAction.change.id}: ****{' '}
              {confirmAction.change.old_account_last4 || '????'} → ****{' '}
              {confirmAction.change.new_account_last4 || '????'}
            </Typography>

            <Typography variant="body2" sx={{ mt: 1 }}>
              {confirmAction.kind === 'bank-approve'
                ? 'Approving applies the new account to the vendor and marks the callback as verified.'
                : 'Rejecting leaves the vendor account unchanged and discards the requested account.'}
            </Typography>
          </>
        )}
      </ConfirmDialog>
    </Drawer>
  )
}

// --------------------------------------------------
// PAGE
// --------------------------------------------------

export default function Vendors({
  user,
  onDataChanged,
}: {
  user: User
  onDataChanged: () => void | Promise<void>
}) {
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

  const [formOpen, setFormOpen] = useState(false)
  const [notice, setNotice] = useState('')

  const canWrite =
    canManageVendors(user.role) && isActiveUser(user.status)

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

  async function refreshAll() {
    await loadVendors()
    await loadSummary()
    await onDataChanged()
  }

  async function handleCreated(vendor: VendorDetail) {
    setFormOpen(false)
    setNotice(
      `Vendor ${vendor.id} onboarded as ${formatLabel(vendor.status)}.`
    )
    setSelectedVendorId(vendor.id)
    await refreshAll()
  }

  async function handleDetailChanged() {
    await refreshAll()
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
                Onboard suppliers, manage lifecycle and review controlled bank
                changes. Bank accounts are always masked.
              </Typography>
            </Box>

            <Stack direction="row" spacing={2}>
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

              {canWrite && (
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => setFormOpen(true)}
                  sx={{
                    backgroundColor: '#404D73',
                    '&:hover': { backgroundColor: '#354263' },
                  }}
                >
                  Onboard vendor
                </Button>
              )}
            </Stack>
          </Stack>

          {!isActiveUser(user.status) && (
            <Alert severity="info" icon={<LockOutlinedIcon />} sx={{ mt: 2 }}>
              Your account is not active. Vendor data is read-only.
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

            <TextField
              select
              size="small"
              label="Status"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as StatusFilter)
                setPage(0)
              }}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="ALL">All statuses</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="on_hold">On hold</MenuItem>
              <MenuItem value="pending_review">Pending review</MenuItem>
            </TextField>

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
                      aria-label={`Open vendor ${vendor.id}`}
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
                        <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                          <Chip
                            size="small"
                            label={formatLabel(vendor.status)}
                            color={vendorStatusColor(vendor.status)}
                            sx={{ fontWeight: 600 }}
                          />

                          {vendor.pending_bank_change && (
                            <Chip
                              size="small"
                              variant="outlined"
                              color="warning"
                              label="Bank change pending"
                            />
                          )}
                        </Stack>
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
                        {isYes(vendor.requires_po) ? 'Required' : 'No'}
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

      {formOpen && (
        <VendorFormDialog
          mode="create"
          onClose={() => setFormOpen(false)}
          onSaved={handleCreated}
        />
      )}

      {selectedVendorId && (
        <VendorDetailDrawer
          key={selectedVendorId}
          vendorId={selectedVendorId}
          user={user}
          onClose={() => setSelectedVendorId(null)}
          onChanged={handleDetailChanged}
          onNotice={setNotice}
        />
      )}

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={5000}
        onClose={() => setNotice('')}
        message={notice}
      />
    </Box>
  )
}
