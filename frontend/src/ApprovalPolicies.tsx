import { useEffect, useRef, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'

import AddIcon from '@mui/icons-material/Add'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'

import {
  policyService,
  type Policy,
  type PolicyConditions,
  type PolicyMatch,
  type PolicyRole,
  type PolicyRule,
  type PolicyStep,
  type PolicyValue,
  type PolicyWritePayload,
  type User,
} from './api/services'

import {
  describeError,
  getFieldErrors,
  type ErrorPresentation,
} from './api/errors'

import {
  canEditPolicies,
  canReadPolicies,
  isActiveUser,
} from './auth/permissions'

// --------------------------------------------------
// POLICY METADATA
// --------------------------------------------------

type FieldType = 'money' | 'string' | 'bool' | 'date'

interface FieldDefinition {
  value: string
  label: string
  type: FieldType
}

const POLICY_FIELDS: FieldDefinition[] = [
  { value: 'invoice.total_cad', label: 'Invoice total (CAD)', type: 'money' },
  { value: 'invoice.currency', label: 'Invoice currency', type: 'string' },
  {
    value: 'invoice.ship_to_province',
    label: 'Ship-to province',
    type: 'string',
  },
  { value: 'invoice.has_po', label: 'Has purchase order', type: 'bool' },
  { value: 'invoice.has_contract', label: 'Has contract', type: 'bool' },
  {
    value: 'invoice.is_credit_note',
    label: 'Is credit note',
    type: 'bool',
  },
  {
    value: 'invoice.department_id',
    label: 'Invoice department ID',
    type: 'string',
  },
  { value: 'invoice.requester_id', label: 'Requester ID', type: 'string' },
  { value: 'vendor.status', label: 'Vendor status', type: 'string' },
  { value: 'vendor.category', label: 'Vendor category', type: 'string' },
  {
    value: 'vendor.province_or_state',
    label: 'Vendor province/state',
    type: 'string',
  },
  { value: 'vendor.requires_po', label: 'Vendor requires PO', type: 'bool' },
  { value: 'vendor.is_new', label: 'New vendor', type: 'bool' },
  {
    value: 'vendor.onboarded_at',
    label: 'Vendor onboarded date',
    type: 'date',
  },
  { value: 'requester.role', label: 'Requester role', type: 'string' },
  {
    value: 'requester.department_id',
    label: 'Requester department ID',
    type: 'string',
  },
]

const OPERATORS: Record<
  FieldType,
  Array<{ value: string; label: string }>
> = {
  money: [
    { value: 'eq', label: '=' },
    { value: 'ne', label: '≠' },
    { value: 'gt', label: '>' },
    { value: 'gte', label: '≥' },
    { value: 'lt', label: '<' },
    { value: 'lte', label: '≤' },
    { value: 'is_null', label: 'is null' },
    { value: 'is_not_null', label: 'is not null' },
  ],
  date: [
    { value: 'eq', label: '=' },
    { value: 'ne', label: '≠' },
    { value: 'gt', label: '>' },
    { value: 'gte', label: '≥' },
    { value: 'lt', label: '<' },
    { value: 'lte', label: '≤' },
    { value: 'is_null', label: 'is null' },
    { value: 'is_not_null', label: 'is not null' },
  ],
  bool: [
    { value: 'eq', label: '=' },
    { value: 'ne', label: '≠' },
    { value: 'is_null', label: 'is null' },
    { value: 'is_not_null', label: 'is not null' },
  ],
  string: [
    { value: 'eq', label: '=' },
    { value: 'ne', label: '≠' },
    { value: 'in', label: 'in' },
    { value: 'not_in', label: 'not in' },
    { value: 'contains', label: 'contains' },
    { value: 'is_null', label: 'is null' },
    { value: 'is_not_null', label: 'is not null' },
  ],
}

const ROLE_OPTIONS: Array<{ value: PolicyRole; label: string }> = [
  { value: 'APPROVER', label: 'Approver' },
  { value: 'FINANCE_MANAGER', label: 'Finance Manager' },
  { value: 'CONTROLLER', label: 'Controller' },
]

function fieldDefinition(value: string): FieldDefinition {
  return (
    POLICY_FIELDS.find((field) => field.value === value) ?? {
      value,
      label: value,
      type: 'string',
    }
  )
}

function operatorsFor(field: string) {
  return OPERATORS[fieldDefinition(field).type]
}

function operatorLabel(op: string): string {
  for (const list of Object.values(OPERATORS)) {
    const match = list.find((item) => item.value === op)
    if (match) return match.label
  }
  return op
}

function formatPolicyValue(value: PolicyValue | undefined): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === null || value === undefined) return ''
  return String(value)
}

function describeRule(rule: PolicyRule): string {
  const field = fieldDefinition(rule.field)
  const value = formatPolicyValue(rule.value)

  if (
    rule.op === 'is_null' ||
    rule.op === 'is_not_null' ||
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return `${field.label} ${operatorLabel(rule.op)}`
  }

  return `${field.label} ${operatorLabel(rule.op)} ${value}`
}

function isPolicyRule(value: unknown): value is PolicyRule {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as PolicyRule).field === 'string' &&
      typeof (value as PolicyRule).op === 'string'
  )
}

function isPolicyStep(value: unknown): value is PolicyStep {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as PolicyStep).role === 'string'
  )
}

function policyMalformed(policy: Policy): boolean {
  const conditions = policy.conditions as unknown

  if (conditions !== undefined && conditions !== null) {
    if (typeof conditions !== 'object' || Array.isArray(conditions)) {
      return true
    }

    const rules = (conditions as { rules?: unknown }).rules

    if (rules !== undefined && !Array.isArray(rules)) {
      return true
    }
  }

  if (policy.steps !== undefined && !Array.isArray(policy.steps)) {
    return true
  }

  return false
}

function isApprovalPolicy(policy: Policy): boolean {
  return (
    !policy.rule_type ||
    policy.rule_type === '' ||
    policy.rule_type === 'approval'
  )
}

function describeConditions(conditions: PolicyConditions | undefined): string {
  const raw = conditions as unknown

  if (raw === undefined || raw === null) return 'Always matches'

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return 'Malformed conditions'
  }

  const container = raw as { match?: unknown; rules?: unknown }

  if (container.rules !== undefined && !Array.isArray(container.rules)) {
    return 'Malformed conditions'
  }

  const rules = (container.rules ?? []).filter(isPolicyRule)

  if (rules.length === 0) return 'Always matches'

  const parts = rules.slice(0, 2).map(describeRule)
  const suffix = rules.length > 2 ? ` +${rules.length - 2} more` : ''

  return `${container.match === 'any' ? 'Any' : 'All'} of: ${parts.join(
    '; '
  )}${suffix}`
}

function describeSteps(steps: PolicyStep[] | undefined): string {
  if (!Array.isArray(steps)) return 'Malformed steps'
  if (steps.length === 0) return 'No steps'

  const valid = steps.filter(isPolicyStep)

  if (valid.length !== steps.length) return 'Malformed steps'

  return valid
    .map((step) => {
      const role =
        ROLE_OPTIONS.find((option) => option.value === step.role)?.label ??
        step.role
      return step.approver_id ? `${role} (${step.approver_id})` : role
    })
    .join(' → ')
}

let nextEditorKey = 0

function editorKey(): string {
  nextEditorKey += 1
  return `editor-${nextEditorKey}`
}

interface EditorRule {
  key: string
  field: string
  op: string
  value: string
}

interface EditorStep {
  key: string
  role: PolicyRole
  approver_id: string
}

function toEditorRules(
  conditions: PolicyConditions | undefined
): EditorRule[] {
  if (!Array.isArray(conditions?.rules)) return []

  return conditions.rules.filter(isPolicyRule).map((rule) => ({
    key: editorKey(),
    field: rule.field,
    op: rule.op,
    value: formatPolicyValue(rule.value),
  }))
}

function toEditorSteps(steps: PolicyStep[] | undefined): EditorStep[] {
  if (!Array.isArray(steps)) return []

  return steps.filter(isPolicyStep).map((step) => ({
    key: editorKey(),
    role: step.role,
    approver_id: step.approver_id ?? '',
  }))
}

// --------------------------------------------------
// POLICY EDITOR
// --------------------------------------------------

interface PolicyEditorProps {
  mode: 'create' | 'edit' | 'view'
  policy: Policy | null
  readOnly: boolean
  onClose: () => void
  onSaved: (policy: Policy) => void | Promise<void>
}

function PolicyEditor({
  mode,
  policy,
  readOnly,
  onClose,
  onSaved,
}: PolicyEditorProps) {
  const [name, setName] = useState(policy?.name ?? '')
  const [priority, setPriority] = useState(
    String(policy?.priority ?? 100)
  )
  const [active, setActive] = useState(policy?.active ?? true)
  const [match, setMatch] = useState<PolicyMatch>(
    policy?.conditions?.match ?? 'all'
  )
  const [rules, setRules] = useState<EditorRule[]>(() =>
    toEditorRules(policy?.conditions)
  )
  const [steps, setSteps] = useState<EditorStep[]>(() => {
    const existing = toEditorSteps(policy?.steps)
    return existing.length > 0 || mode !== 'create'
      ? existing
      : [{ key: editorKey(), role: 'APPROVER', approver_id: '' }]
  })

  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState<ErrorPresentation | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(
    {}
  )

  const disabled = readOnly || saving

  function updateRule(key: string, patch: Partial<EditorRule>) {
    setRules((previous) =>
      previous.map((rule) =>
        rule.key === key ? { ...rule, ...patch } : rule
      )
    )
  }

  function changeRuleField(key: string, field: string) {
    const nextOperators = operatorsFor(field)
    const nextOp = nextOperators[0]?.value ?? 'eq'
    const nextValue =
      fieldDefinition(field).type === 'bool' &&
      nextOp !== 'is_null' &&
      nextOp !== 'is_not_null'
        ? 'true'
        : ''

    updateRule(key, {
      field,
      op: nextOp,
      value: nextValue,
    })
  }

  function changeRuleOperator(key: string, op: string) {
    setRules((previous) =>
      previous.map((rule) => {
        if (rule.key !== key) return rule

        const noValue = op === 'is_null' || op === 'is_not_null'
        const needsBoolDefault =
          !noValue &&
          fieldDefinition(rule.field).type === 'bool' &&
          !rule.value

        return {
          ...rule,
          op,
          value: noValue ? '' : needsBoolDefault ? 'true' : rule.value,
        }
      })
    )
  }

  function addRule() {
    if (rules.length >= 20 || disabled) return

    setRules((previous) => [
      ...previous,
      {
        key: editorKey(),
        field: 'invoice.total_cad',
        op: 'gt',
        value: '',
      },
    ])
  }

  function removeRule(key: string) {
    if (disabled) return
    setRules((previous) => previous.filter((rule) => rule.key !== key))
  }

  function updateStep(key: string, patch: Partial<EditorStep>) {
    setSteps((previous) =>
      previous.map((step) =>
        step.key === key ? { ...step, ...patch } : step
      )
    )
  }

  function addStep() {
    if (steps.length >= 10 || disabled) return

    setSteps((previous) => [
      ...previous,
      {
        key: editorKey(),
        role: 'APPROVER',
        approver_id: '',
      },
    ])
  }

  function removeStep(key: string) {
    if (disabled || steps.length <= 1) return
    setSteps((previous) => previous.filter((step) => step.key !== key))
  }

  function moveStep(index: number, direction: -1 | 1) {
    if (disabled) return

    const target = index + direction
    if (target < 0 || target >= steps.length) return

    setSteps((previous) => {
      const next = [...previous]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  function buildPayload(): {
    payload: PolicyWritePayload | null
    errors: Record<string, string>
  } {
    const errors: Record<string, string> = {}
    const trimmedName = name.trim()

    if (!trimmedName) {
      errors.name = 'Name is required.'
    } else if (trimmedName.length > 100) {
      errors.name = 'Name must be 100 characters or fewer.'
    }

    if (!/^\d+$/.test(priority.trim())) {
      errors.priority = 'Enter a whole number (0 or more).'
    } else if (!Number.isSafeInteger(Number(priority.trim()))) {
      errors.priority = 'Priority is too large.'
    }

    if (rules.length > 20) {
      errors.rules = 'At most 20 condition rules are allowed.'
    }

    if (steps.length === 0) {
      errors.steps = 'At least one approval step is required.'
    } else if (steps.length > 10) {
      errors.steps = 'At most 10 approval steps are allowed.'
    }

    const builtRules: PolicyRule[] = []

    for (const rule of rules) {
      const field = fieldDefinition(rule.field)
      const allowed = operatorsFor(rule.field)

      if (!allowed.some((item) => item.value === rule.op)) {
        errors[`rule-${rule.key}`] = 'Choose a valid operator.'
        continue
      }

      if (rule.op === 'is_null' || rule.op === 'is_not_null') {
        builtRules.push({ field: rule.field, op: rule.op })
        continue
      }

      if (field.type === 'bool') {
        if (rule.value !== 'true' && rule.value !== 'false') {
          errors[`rule-${rule.key}`] = 'Choose true or false.'
        } else {
          builtRules.push({
            field: rule.field,
            op: rule.op,
            value: rule.value === 'true',
          })
        }
      } else if (field.type === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.value)) {
          errors[`rule-${rule.key}`] = 'Use an ISO date (YYYY-MM-DD).'
        } else {
          builtRules.push({
            field: rule.field,
            op: rule.op,
            value: rule.value,
          })
        }
      } else if (field.type === 'money') {
        if (!/^-?\d+(\.\d+)?$/.test(rule.value.trim())) {
          errors[`rule-${rule.key}`] = 'Enter a decimal amount.'
        } else {
          builtRules.push({
            field: rule.field,
            op: rule.op,
            value: rule.value.trim(),
          })
        }
      } else if (rule.op === 'in' || rule.op === 'not_in') {
        const values = rule.value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)

        if (values.length === 0) {
          errors[`rule-${rule.key}`] = 'Add at least one value.'
        } else {
          builtRules.push({
            field: rule.field,
            op: rule.op,
            value: values,
          })
        }
      } else if (!rule.value.trim()) {
        errors[`rule-${rule.key}`] = 'Enter a value.'
      } else {
        builtRules.push({
          field: rule.field,
          op: rule.op,
          value: rule.value,
        })
      }
    }

    if (
      steps.some(
        (step) =>
          !ROLE_OPTIONS.some((option) => option.value === step.role)
      )
    ) {
      errors.steps = 'Choose a valid role for every step.'
    }

    if (Object.keys(errors).length > 0) {
      return { payload: null, errors }
    }

    return {
      errors: {},
      payload: {
        name: trimmedName,
        priority: Number(priority.trim()),
        active,
        conditions: { match, rules: builtRules },
        steps: steps.map((step, index) => ({
          step_no: index + 1,
          role: step.role,
          approver_id: step.approver_id.trim() || null,
        })),
      },
    }
  }

  async function handleSave() {
    if (savingRef.current || readOnly) return

    const { payload, errors } = buildPayload()

    if (!payload) {
      setFieldErrors(errors)
      return
    }

    savingRef.current = true
    setSaving(true)
    setError(null)
    setFieldErrors({})

    try {
      const saved =
        mode === 'create' || !policy
          ? await policyService.create(payload)
          : await policyService.update(policy.id, payload)

      await onSaved(saved)
    } catch (err) {
      setError(describeError(err))
      setFieldErrors(getFieldErrors(err))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const title =
    mode === 'create'
      ? 'New approval policy'
      : mode === 'edit'
        ? 'Edit approval policy'
        : 'Policy details'

  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) onClose()
      }}
      maxWidth="lg"
      fullWidth
    >
      <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
        {title}
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={3}>
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

          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ alignItems: { xs: 'stretch', md: 'flex-start' } }}
          >
            <TextField
              fullWidth
              required
              label="Policy name"
              value={name}
              disabled={disabled}
              error={Boolean(fieldErrors.name)}
              helperText={fieldErrors.name}
              onChange={(event) => setName(event.target.value)}
            />

            <TextField
              label="Priority"
              type="number"
              value={priority}
              disabled={disabled}
              error={Boolean(fieldErrors.priority)}
              helperText={fieldErrors.priority}
              slotProps={{ htmlInput: { min: 0 } }}
              onChange={(event) => setPriority(event.target.value)}
              sx={{ width: { xs: '100%', md: 160 } }}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={active}
                  disabled={disabled}
                  onChange={(event) => setActive(event.target.checked)}
                />
              }
              label="Active"
              sx={{ mt: { md: 1 } }}
            />
          </Stack>

          <Alert severity="info">
            Policies are evaluated in priority order and apply to future
            submissions. Higher priority numbers run later. Changes are
            audited.
          </Alert>

          <Box>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{
                justifyContent: 'space-between',
                alignItems: { xs: 'stretch', sm: 'center' },
                mb: 1.5,
              }}
            >
              <Box>
                <Typography sx={{ fontWeight: 700, color: '#263451' }}>
                  Conditions
                </Typography>

                <Typography variant="caption" color="text.secondary">
                  No rules means this policy always matches. Max 20 rules.
                </Typography>
              </Box>

              <Stack direction="row" spacing={2}>
                <TextField
                  select
                  size="small"
                  label="Match"
                  value={match}
                  disabled={disabled}
                  onChange={(event) =>
                    setMatch(event.target.value as PolicyMatch)
                  }
                  sx={{ minWidth: 110 }}
                >
                  <MenuItem value="all">All rules</MenuItem>
                  <MenuItem value="any">Any rule</MenuItem>
                </TextField>

                {!readOnly && (
                  <Button
                    startIcon={<AddIcon />}
                    disabled={disabled || rules.length >= 20}
                    onClick={addRule}
                  >
                    Add rule
                  </Button>
                )}
              </Stack>
            </Stack>

            {fieldErrors.conditions && (
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                {fieldErrors.conditions}
              </Alert>
            )}

            {rules.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Always matches (no conditions).
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {rules.map((rule) => {
                  const field = fieldDefinition(rule.field)
                  const noValue =
                    rule.op === 'is_null' || rule.op === 'is_not_null'

                  return (
                    <Box
                      key={rule.key}
                      sx={{
                        border: '1px solid #E5E7EB',
                        borderRadius: 1,
                        p: 1.5,
                      }}
                    >
                      <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={1.5}
                        sx={{ alignItems: { md: 'flex-start' } }}
                      >
                        <TextField
                          select
                          size="small"
                          label="Field"
                          value={rule.field}
                          disabled={disabled}
                          onChange={(event) =>
                            changeRuleField(rule.key, event.target.value)
                          }
                          sx={{ minWidth: { md: 220 } }}
                        >
                          {POLICY_FIELDS.map((option) => (
                            <MenuItem
                              key={option.value}
                              value={option.value}
                            >
                              {option.label}
                            </MenuItem>
                          ))}
                        </TextField>

                        <TextField
                          select
                          size="small"
                          label="Operator"
                          value={rule.op}
                          disabled={disabled}
                          onChange={(event) =>
                            changeRuleOperator(
                              rule.key,
                              event.target.value
                            )
                          }
                          sx={{ minWidth: { md: 130 } }}
                        >
                          {operatorsFor(rule.field).map((option) => (
                            <MenuItem
                              key={option.value}
                              value={option.value}
                            >
                              {option.label}
                            </MenuItem>
                          ))}
                        </TextField>

                        {!noValue && (
                          <Box sx={{ flex: 1, minWidth: 180 }}>
                            {field.type === 'bool' ? (
                              <TextField
                                select
                                fullWidth
                                size="small"
                                label="Value"
                                value={rule.value}
                                disabled={disabled}
                                onChange={(event) =>
                                  updateRule(rule.key, {
                                    value: event.target.value,
                                  })
                                }
                              >
                                <MenuItem value="true">True</MenuItem>
                                <MenuItem value="false">False</MenuItem>
                              </TextField>
                            ) : (
                              <TextField
                                fullWidth
                                size="small"
                                label="Value"
                                type={field.type === 'date' ? 'date' : 'text'}
                                value={rule.value}
                                disabled={disabled}
                                placeholder={
                                  rule.op === 'in' ||
                                  rule.op === 'not_in'
                                    ? 'Comma-separated values'
                                    : field.type === 'money'
                                      ? 'e.g. 10000'
                                      : undefined
                                }
                                slotProps={
                                  field.type === 'date'
                                    ? { inputLabel: { shrink: true } }
                                    : undefined
                                }
                                onChange={(event) =>
                                  updateRule(rule.key, {
                                    value: event.target.value,
                                  })
                                }
                              />
                            )}
                          </Box>
                        )}

                        {!readOnly && (
                          <Button
                            color="error"
                            size="small"
                            disabled={disabled}
                            onClick={() => removeRule(rule.key)}
                          >
                            Remove
                          </Button>
                        )}
                      </Stack>

                      {fieldErrors[`rule-${rule.key}`] && (
                        <Typography
                          variant="caption"
                          color="error"
                          sx={{ display: 'block', mt: 0.5 }}
                        >
                          {fieldErrors[`rule-${rule.key}`]}
                        </Typography>
                      )}
                    </Box>
                  )
                })}
              </Stack>
            )}
          </Box>

          <Divider />

          <Box>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{
                justifyContent: 'space-between',
                alignItems: { xs: 'stretch', sm: 'center' },
                mb: 1.5,
              }}
            >
              <Box>
                <Typography sx={{ fontWeight: 700, color: '#263451' }}>
                  Approval steps
                </Typography>

                <Typography variant="caption" color="text.secondary">
                  Sequential. Max 10 steps. Leave approver blank for role-based
                  routing.
                </Typography>
              </Box>

              {!readOnly && (
                <Button
                  startIcon={<AddIcon />}
                  disabled={disabled || steps.length >= 10}
                  onClick={addStep}
                >
                  Add step
                </Button>
              )}
            </Stack>

            {fieldErrors.steps && (
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                {fieldErrors.steps}
              </Alert>
            )}

            <Stack spacing={1.5}>
              {steps.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No steps configured. Add at least one step before saving or
                  activating this policy.
                </Typography>
              ) : (
              steps.map((step, index) => (
                <Stack
                  key={step.key}
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={1.5}
                  sx={{
                    alignItems: { md: 'center' },
                    border: '1px solid #E5E7EB',
                    borderRadius: 1,
                    p: 1.5,
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 700, minWidth: 62 }}
                  >
                    Step {index + 1}
                  </Typography>

                  <TextField
                    select
                    size="small"
                    label="Role"
                    value={step.role}
                    disabled={disabled}
                    onChange={(event) =>
                      updateStep(step.key, {
                        role: event.target.value as PolicyRole,
                      })
                    }
                    sx={{ minWidth: 190 }}
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    size="small"
                    label="Specific approver ID (optional)"
                    value={step.approver_id}
                    disabled={disabled}
                    onChange={(event) =>
                      updateStep(step.key, {
                        approver_id: event.target.value,
                      })
                    }
                    helperText="Must match the role and be enabled"
                    sx={{ flex: 1, minWidth: 220 }}
                  />

                  {!readOnly && (
                    <Stack direction="row" spacing={0.5}>
                      <Button
                        size="small"
                        disabled={disabled || index === 0}
                        onClick={() => moveStep(index, -1)}
                      >
                        Up
                      </Button>

                      <Button
                        size="small"
                        disabled={disabled || index === steps.length - 1}
                        onClick={() => moveStep(index, 1)}
                      >
                        Down
                      </Button>

                      <Button
                        size="small"
                        color="error"
                        disabled={disabled || steps.length <= 1}
                        onClick={() => removeStep(step.key)}
                      >
                        Remove
                      </Button>
                    </Stack>
                  )}
                </Stack>
              ))
              )}
            </Stack>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ p: 2.5 }}>
        <Button onClick={onClose} disabled={saving}>
          {readOnly ? 'Close' : 'Cancel'}
        </Button>

        {!readOnly && (
          <Button
            variant="contained"
            disabled={saving}
            onClick={() => {
              void handleSave()
            }}
            sx={{
              backgroundColor: '#404D73',
              '&:hover': { backgroundColor: '#354263' },
            }}
          >
            {saving ? 'Saving...' : 'Save policy'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

// --------------------------------------------------
// POLICY LIST / SETTINGS SECTION
// --------------------------------------------------

interface EditorState {
  mode: 'create' | 'edit' | 'view'
  policy: Policy | null
}

export default function ApprovalPolicies({ user }: { user: User }) {
  const readAllowed =
    canReadPolicies(user.role) && user.status !== 'terminated'
  const editAllowed =
    canEditPolicies(user.role) && isActiveUser(user.status)

  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ErrorPresentation | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [activeFilter, setActiveFilter] = useState<
    'ALL' | 'active' | 'inactive'
  >('ALL')

  const [editor, setEditor] = useState<EditorState | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Policy | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] =
    useState<ErrorPresentation | null>(null)

  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!readAllowed) return

    let cancelled = false

    policyService
      .listAll()
      .then((response) => {
        if (cancelled) return
        setPolicies(response.results)
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
  }, [readAllowed, reloadToken])

  function retry() {
    setLoading(true)
    setError(null)
    setReloadToken((token) => token + 1)
  }

  async function handleSaved(policy: Policy) {
    setEditor(null)
    setActionError(null)
    setNotice(`Policy ${policy.id} saved.`)
    setLoading(true)
    setError(null)
    setReloadToken((token) => token + 1)
  }

  async function handleArchive() {
    if (!archiveTarget) return

    setActionLoading(true)
    setActionError(null)

    try {
      await policyService.archive(archiveTarget.id)
      setActionError(null)
      setNotice(`Policy ${archiveTarget.id} archived (inactive).`)
      setArchiveTarget(null)
      setLoading(true)
      setError(null)
      setReloadToken((token) => token + 1)
    } catch (err) {
      setActionError(describeError(err))
    } finally {
      setActionLoading(false)
    }
  }

  async function handleActivate(policy: Policy) {
    setActionLoading(true)
    setActionError(null)

    try {
      await policyService.update(policy.id, { active: true })
      setActionError(null)
      setNotice(`Policy ${policy.id} activated.`)
      setLoading(true)
      setError(null)
      setReloadToken((token) => token + 1)
    } catch (err) {
      setActionError(describeError(err))
    } finally {
      setActionLoading(false)
    }
  }

  if (!readAllowed) {
    return (
      <Alert severity="info" icon={<LockOutlinedIcon />}>
        Approval policy administration is available to Controller and Auditor
        roles. The Controller manages policy changes.
      </Alert>
    )
  }

  const structured = policies.filter(
    (policy) =>
      isApprovalPolicy(policy) &&
      (Boolean(policy.name && policy.name.trim()) ||
        (Array.isArray(policy.steps) && policy.steps.length > 0))
  )

  const referenceCount = policies.length - structured.length

  const visible = structured.filter((policy) => {
    if (activeFilter === 'active') return policy.active
    if (activeFilter === 'inactive') return !policy.active
    return true
  })

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', md: 'center' },
          mb: 2,
        }}
      >
        <Box>
          <Typography sx={{ fontWeight: 700, color: '#263451' }}>
            Structured policies
          </Typography>

          <Typography variant="caption" color="text.secondary">
            Evaluated in priority order; changes apply to future submissions
            and are audited.
          </Typography>

          {referenceCount > 0 && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block' }}
            >
              {referenceCount} reference row
              {referenceCount === 1 ? '' : 's'} hidden.
            </Typography>
          )}
        </Box>

        <Stack direction="row" spacing={2}>
          <TextField
            select
            size="small"
            label="Show"
            value={activeFilter}
            onChange={(event) =>
              setActiveFilter(
                event.target.value as 'ALL' | 'active' | 'inactive'
              )
            }
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="ALL">All structured</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
          </TextField>

          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            disabled={loading}
            onClick={retry}
          >
            Refresh
          </Button>

          {editAllowed && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() =>
                setEditor({ mode: 'create', policy: null })
              }
              sx={{
                backgroundColor: '#404D73',
                '&:hover': { backgroundColor: '#354263' },
              }}
            >
              New policy
            </Button>
          )}
        </Stack>
      </Stack>

      {!editAllowed && (
        <Alert severity="info" icon={<LockOutlinedIcon />} sx={{ mb: 2 }}>
          {user.status === 'on_leave'
            ? 'Your account is on leave; policy changes are disabled.'
            : isActiveUser(user.status)
              ? 'Read-only: your role can view policies but not change them.'
              : 'Your account is not active. Policy data is read-only.'}
        </Alert>
      )}

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

      <Card variant="outlined" sx={{ borderColor: '#E2E6EF' }}>
        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 3 }}>
            <CircularProgress size={20} />
            <Typography color="text.secondary">
              Loading policies...
            </Typography>
          </Box>
        ) : error ? (
          <Box sx={{ p: 3 }}>
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={retry}>
                  Retry
                </Button>
              }
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Could not load policies ({error.code})
              </Typography>

              <Typography variant="body2">{error.message}</Typography>
            </Alert>
          </Box>
        ) : visible.length === 0 ? (
          <Box sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary">
              No structured approval policies match this view.
            </Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: '#F4F6FA' }}>
                  <TableCell sx={{ fontWeight: 700 }}>Priority</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Conditions</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Steps</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {visible.map((policy) => (
                  <TableRow key={policy.id} hover>
                    <TableCell>{policy.priority}</TableCell>

                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {policy.name || policy.id}
                      </Typography>

                      <Typography variant="caption" color="text.secondary">
                        {policy.id}
                      </Typography>
                    </TableCell>

                    <TableCell>
                      <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                        <Chip
                          size="small"
                          label={policy.active ? 'Active' : 'Inactive'}
                          color={policy.active ? 'success' : 'default'}
                          variant={policy.active ? 'filled' : 'outlined'}
                        />

                        {policyMalformed(policy) && (
                          <Chip
                            size="small"
                            label="Malformed data"
                            color="warning"
                            variant="outlined"
                          />
                        )}
                      </Stack>
                    </TableCell>

                    <TableCell sx={{ maxWidth: 340 }}>
                      <Typography variant="body2">
                        {describeConditions(policy.conditions)}
                      </Typography>
                    </TableCell>

                    <TableCell sx={{ maxWidth: 280 }}>
                      <Typography variant="body2">
                        {describeSteps(policy.steps)}
                      </Typography>
                    </TableCell>

                    <TableCell align="right">
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}
                      >
                        <Button
                          size="small"
                          onClick={() => {
                            setActionError(null)
                            setEditor({
                              mode: editAllowed ? 'edit' : 'view',
                              policy,
                            })
                          }}
                        >
                          {editAllowed ? 'Edit' : 'View'}
                        </Button>

                        {editAllowed && policy.active && (
                          <Button
                            size="small"
                            color="inherit"
                            disabled={actionLoading}
                            onClick={() => {
                              setActionError(null)
                              setArchiveTarget(policy)
                            }}
                          >
                            Archive
                          </Button>
                        )}

                        {editAllowed && !policy.active && (
                          <Button
                            size="small"
                            disabled={
                              actionLoading ||
                              !Array.isArray(policy.steps) ||
                              policy.steps.length === 0
                            }
                            title={
                              Array.isArray(policy.steps) &&
                              policy.steps.length > 0
                                ? undefined
                                : 'Add at least one step before activating'
                            }
                            onClick={() => {
                              void handleActivate(policy)
                            }}
                          >
                            Activate
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
      </Card>

      {editor && (
        <PolicyEditor
          key={`${editor.mode}-${editor.policy?.id ?? 'new'}`}
          mode={editor.mode}
          policy={editor.policy}
          readOnly={!editAllowed || editor.mode === 'view'}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
        />
      )}

      <Dialog
        open={archiveTarget !== null}
        onClose={() => {
          if (!actionLoading) setArchiveTarget(null)
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
          Archive policy
        </DialogTitle>

        <DialogContent dividers>
          {actionError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {actionError.code}
              </Typography>

              <Typography variant="body2">{actionError.message}</Typography>
            </Alert>
          )}

          <Typography variant="body2">
            Archive {archiveTarget?.name || archiveTarget?.id}? This sets the
            policy inactive. It can be reactivated later from this list.
          </Typography>
        </DialogContent>

        <DialogActions sx={{ p: 2.5 }}>
          <Button
            onClick={() => setArchiveTarget(null)}
            disabled={actionLoading}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            color="error"
            disabled={actionLoading}
            onClick={() => {
              void handleArchive()
            }}
          >
            {actionLoading ? 'Archiving...' : 'Archive'}
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
