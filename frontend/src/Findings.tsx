import { useState } from 'react'

import {
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material'

import type { Finding } from './api/services'

// --------------------------------------------------
// LABELS
// --------------------------------------------------

const CODE_LABELS: Record<string, string> = {
  MISSING_FIELD: 'Missing field',
  INVALID_AMOUNT: 'Invalid amount',
  TOTAL_MISMATCH: 'Total mismatch',
  EXTRACTION_FAILED: 'Extraction failed',
  EXTRACTION_UNREADABLE: 'File unreadable',
  VENDOR_UNKNOWN: 'Unknown vendor',
  VENDOR_ON_HOLD: 'Vendor not approved',
  TAX_RATE_MISMATCH: 'Tax amount mismatch',
  TAX_PROVINCE_MISMATCH: 'Tax code not valid for province',
  EXACT_DUPLICATE: 'Exact duplicate invoice',
  POSSIBLE_DUPLICATE: 'Possible duplicate invoice',
  CARD_INVOICE: 'Possible card reuse',
  PO_NOT_FOUND: 'Purchase order not found',
  PO_REQUIRED_MISSING: 'Purchase order required',
  PO_VENDOR_MISMATCH: 'Purchase order vendor mismatch',
  PO_CURRENCY_MISMATCH: 'Purchase order currency mismatch',
  PO_AMOUNT_EXCEEDED: 'Purchase order amount exceeded',
  PO_CUMULATIVE_EXCEEDED: 'Purchase order cumulative limit exceeded',
  PO_AMOUNT_UNVERIFIABLE: 'Purchase order amount unverifiable',
  CONTRACT_NOT_FOUND: 'Contract not found',
  CONTRACT_VENDOR_MISMATCH: 'Contract vendor mismatch',
  CONTRACT_CURRENCY_MISMATCH: 'Contract currency mismatch',
  CONTRACT_INACTIVE: 'Contract inactive',
  CONTRACT_DATE_OUTSIDE_TERM: 'Invoice outside contract term',
  CONTRACT_FEE_EXCEEDED: 'Contract fee exceeded',
  CONTRACT_RATE_EXCEEDED: 'Above contract hourly rate',
  CONTRACT_MONTHLY_CAP_EXCEEDED: 'Contract monthly cap exceeded',
  UNVERIFIED_BANK_CHANGE: 'Unverified bank change',
}

const EVIDENCE_LABELS: Record<string, string> = {
  expected_amount: 'Expected amount',
  actual_amount: 'Actual amount',
  difference: 'Difference',
  taxable_amount: 'Taxable amount',
  rate: 'Rate',
  province: 'Province',
  ship_to_province: 'Ship-to province',
  tax_code: 'Tax code',
  expected_total: 'Expected total',
  actual_total: 'Actual total',
  source: 'Source',
  po_id: 'Purchase order',
  po_total: 'PO total',
  prior_invoiced: 'Previously invoiced',
  current_invoice: 'Current invoice',
  cumulative: 'Cumulative',
  contract_id: 'Contract',
  matching_invoice_id: 'Matching invoice',
  matching_invoice_date: 'Matching invoice date',
  days_apart: 'Days apart',
  match_type: 'Match type',
  paid_by: 'Paid by',
  invoice_total: 'Invoice total',
  po_vendor_id: 'PO vendor',
  invoice_vendor_id: 'Invoice vendor',
  invoice_currency: 'Invoice currency',
  po_currency: 'PO currency',
  vendor_id: 'Vendor',
  vendor_status: 'Vendor status',
  requires_po: 'Requires PO',
  expected_codes: 'Expected tax codes',
  actual_codes: 'Actual tax codes',
  fields: 'Changed fields',
  coding_changes: 'Coding changes',
  source_file: 'Source file',
}

function humanize(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function findingCodeLabel(code: string): string {
  return CODE_LABELS[code] ?? humanize(code)
}

function evidenceLabel(key: string): string {
  return EVIDENCE_LABELS[key] ?? humanize(key)
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'

  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    return value
      .map((item) =>
        typeof item === 'object' && item !== null
          ? JSON.stringify(item)
          : String(item)
      )
      .join(', ')
  }

  if (typeof value === 'object') {
    return JSON.stringify(value)
  }

  return String(value)
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

// --------------------------------------------------
// CARD
// --------------------------------------------------

export function FindingCard({
  finding,
  onResolve,
}: {
  finding: Finding
  onResolve?: (finding: Finding) => void
}) {
  const [showRaw, setShowRaw] = useState(false)

  const evidenceEntries = Object.entries(finding.evidence ?? {}).filter(
    ([, value]) => value !== undefined
  )

  return (
    <Box
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
        sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}
      >
        <Chip
          size="small"
          label={finding.severity}
          color={finding.severity === 'BLOCK' ? 'error' : 'warning'}
          sx={{ fontWeight: 700 }}
        />

        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {findingCodeLabel(finding.code)}
        </Typography>

        <Typography variant="caption" color="text.secondary">
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
          <Chip size="small" label="Open" variant="outlined" />
        )}
      </Stack>

      <Typography variant="body2" sx={{ mb: 1.5 }}>
        {finding.message}
      </Typography>

      {evidenceEntries.length > 0 && (
        <Box
          sx={{
            backgroundColor: '#F8F9FC',
            borderRadius: 1,
            p: 1.5,
            mb: 1.5,
          }}
        >
          <Stack spacing={0.5}>
            {evidenceEntries.map(([key, value]) => (
              <Stack
                key={key}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={{ xs: 0, sm: 1 }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ minWidth: 170, fontWeight: 600 }}
                >
                  {evidenceLabel(key)}
                </Typography>

                <Typography
                  variant="caption"
                  sx={{ overflowWrap: 'anywhere' }}
                >
                  {displayValue(value)}
                </Typography>
              </Stack>
            ))}
          </Stack>

          <Button
            size="small"
            sx={{ mt: 1, textTransform: 'none', p: 0, minWidth: 0 }}
            onClick={() => setShowRaw((previous) => !previous)}
          >
            {showRaw ? 'Hide raw evidence' : 'Show raw evidence'}
          </Button>

          {showRaw && (
            <Typography
              component="pre"
              variant="caption"
              sx={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                m: 0,
                mt: 1,
              }}
            >
              {JSON.stringify(finding.evidence, null, 2)}
            </Typography>
          )}
        </Box>
      )}

      {finding.resolution && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mb: 1 }}
        >
          Resolved by {finding.resolution.resolved_by_id} on{' '}
          {formatDateTime(finding.resolution.resolved_at)} —{' '}
          {finding.resolution.justification}
        </Typography>
      )}

      <Divider sx={{ mb: 1 }} />

      {finding.severity === 'BLOCK' ? (
        <Typography variant="caption" color="error.main">
          Blocking findings cannot be overridden. Correct the invoice data and
          re-run analysis.
        </Typography>
      ) : !finding.resolution && onResolve ? (
        <Button
          size="small"
          variant="outlined"
          color="warning"
          onClick={() => onResolve(finding)}
        >
          Resolve warning
        </Button>
      ) : null}
    </Box>
  )
}

export default function FindingList({
  findings,
  onResolve,
}: {
  findings: Finding[]
  onResolve?: (finding: Finding) => void
}) {
  return (
    <Stack spacing={2}>
      {findings.map((finding) => (
        <FindingCard
          key={finding.finding_id}
          finding={finding}
          onResolve={onResolve}
        />
      ))}
    </Stack>
  )
}
