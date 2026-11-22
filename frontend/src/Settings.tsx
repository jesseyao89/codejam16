import { useEffect, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'

import TuneIcon from '@mui/icons-material/Tune'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import AccountBalanceIcon from '@mui/icons-material/AccountBalance'
import BusinessIcon from '@mui/icons-material/Business'
import SearchIcon from '@mui/icons-material/Search'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircle'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'

import ApprovalPolicies from './ApprovalPolicies'

import {
  referenceService,
  type Department,
  type User,
} from './api/services'

import { describeError, type ErrorPresentation } from './api/errors'

type Section = 'General' | 'Approvals' | 'Payments' | 'Departments'

type Policy = {
  id: string
  condition: string
  required: string
  notes: string
}

const additionalControls = [
  {
    name: 'New vendor review',
    description: 'Additional finance approval for new vendors',
  },
  {
    name: 'Legal vendor review',
    description: 'Additional finance approval for legal expenses',
  },
  {
    name: 'No self-approval',
    description: 'Requesters cannot approve their own invoices',
  },
  {
    name: 'Approval delegation',
    description: 'Delegation must be recorded and traceable',
  },
  {
    name: 'Purchase order matching',
    description: 'Check applicable PO requirements and remaining balance',
  },
]

const paymentPolicies: Policy[] = [
  {
    id: 'P09',
    condition: 'Up to $100,000 CAD',
    required: 'Finance Manager',
    notes: 'Authorized payment release',
  },
  {
    id: 'P10',
    condition: 'Over $100,000 CAD',
    required: 'Controller',
    notes: 'Controller authorization required',
  },
]

const paymentControls = [
  {
    name: 'Separation of duties',
    description:
      'Invoice approvers cannot release the same invoice payment',
  },
  {
    name: 'AP clerk restrictions',
    description:
      'AP clerks may prepare payments but cannot release them',
  },
  {
    name: 'Approval verification',
    description:
      'Only fully approved invoices are eligible for payment',
  },
]

const navigation = [
  { label: 'General', icon: <TuneIcon /> },
  { label: 'Approvals', icon: <FactCheckIcon /> },
  { label: 'Payments', icon: <AccountBalanceIcon /> },
  { label: 'Departments', icon: <BusinessIcon /> },
] as const

function SectionHeading({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography
        variant="h6"
        sx={{
          fontWeight: 700,
          color: '#263451',
          fontSize: 19,
        }}
      >
        {title}
      </Typography>

      <Typography
        variant="body2"
        sx={{ color: '#667085', mt: 0.5 }}
      >
        {description}
      </Typography>
    </Box>
  )
}

function PolicyTable({ policies }: { policies: Policy[] }) {
  return (
    <TableContainer
      component={Card}
      variant="outlined"
      sx={{
        borderColor: '#E2E6EF',
        boxShadow: 'none',
        mb: 3,
      }}
    >
      <Table size="small">
        <TableHead sx={{ backgroundColor: '#F4F6FA' }}>
          <TableRow>
            <TableCell sx={{ fontWeight: 700, color: '#404D73' }}>
              Condition
            </TableCell>

            <TableCell sx={{ fontWeight: 700, color: '#404D73' }}>
              Required Approval
            </TableCell>

            <TableCell sx={{ fontWeight: 700, color: '#404D73' }}>
              Notes
            </TableCell>
          </TableRow>
        </TableHead>

        <TableBody>
          {policies.map((policy) => (
            <TableRow key={policy.id} hover>
              <TableCell
                sx={{
                  fontWeight: 600,
                  color: '#263451',
                  py: 1.8,
                }}
              >
                {policy.condition}
              </TableCell>

              <TableCell
                sx={{
                  color: '#404D73',
                  fontWeight: 600,
                  py: 1.8,
                }}
              >
                {policy.required}
              </TableCell>

              <TableCell
                sx={{
                  color: '#667085',
                  py: 1.8,
                }}
              >
                {policy.notes}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function ControlList({
  controls,
}: {
  controls: { name: string; description: string }[]
}) {
  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: '#E2E6EF',
        boxShadow: 'none',
      }}
    >
      {controls.map((control, index) => (
        <Box key={control.name}>
          {index > 0 && <Divider />}

          <Stack
            direction="row"
            spacing={2}
            sx={{
              px: 2.5,
              py: 1.8,
              alignItems: 'center',
            }}
          >
            <CheckCircleOutlineIcon
              sx={{
                color: '#16803C',
                fontSize: 20,
              }}
            />

            <Box sx={{ flex: 1 }}>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 700,
                  color: '#263451',
                }}
              >
                {control.name}
              </Typography>

              <Typography
                variant="body2"
                sx={{
                  color: '#667085',
                  fontSize: 12.5,
                  mt: 0.3,
                }}
              >
                {control.description}
              </Typography>
            </Box>

            <Chip
              label="Reference"
              size="small"
              sx={{
                backgroundColor: '#E8F5EC',
                color: '#166534',
                fontWeight: 600,
                fontSize: 11,
              }}
            />
          </Stack>
        </Box>
      ))}
    </Card>
  )
}

export default function Settings({ user }: { user: User }) {
  const [activeSection, setActiveSection] = useState<Section>('General')
  const [departmentSearch, setDepartmentSearch] = useState('')

  const [departmentList, setDepartmentList] = useState<Department[]>([])
  const [departmentsLoading, setDepartmentsLoading] = useState(true)
  const [departmentsError, setDepartmentsError] =
    useState<ErrorPresentation | null>(null)
  const [departmentReloadToken, setDepartmentReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    referenceService
      .departments()
      .then((response) => {
        if (cancelled) return
        setDepartmentList(response.results)
        setDepartmentsError(null)
        setDepartmentsLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setDepartmentsError(describeError(err))
        setDepartmentsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [departmentReloadToken])

  function retryDepartments() {
    setDepartmentsLoading(true)
    setDepartmentsError(null)
    setDepartmentReloadToken((token) => token + 1)
  }

  const filteredDepartments = departmentList.filter((department) => {
    const query = departmentSearch.toLowerCase().trim()

    return (
      department.name.toLowerCase().includes(query) ||
      (department.cost_centre ?? '').includes(query) ||
      department.id.toLowerCase().includes(query)
    )
  })

  return (
    <Box>
      {/* PAGE DESCRIPTION */}
      <Typography
        variant="body2"
        sx={{
          color: '#667085',
          mb: 3,
          mt: -2,
        }}
      >
        Review your organization's accounts payable configuration.
      </Typography>

      {/* COMPACT SETTINGS LAYOUT */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={3}
        sx={{ alignItems: 'flex-start' }}
      >
        {/* LEFT NAVIGATION */}
        <Card
          variant="outlined"
          sx={{
            width: { xs: '100%', md: 205 },
            flexShrink: 0,
            borderColor: '#E2E6EF',
            boxShadow: 'none',
          }}
        >
          <List sx={{ p: 1 }}>
            {navigation.map((item) => (
              <ListItemButton
                key={item.label}
                selected={activeSection === item.label}
                onClick={() => setActiveSection(item.label)}
                sx={{
                  borderRadius: 1.5,
                  py: 1,
                  mb: 0.3,
                  color: '#667085',

                  '&.Mui-selected': {
                    backgroundColor: '#E9EDF5',
                    color: '#404D73',
                  },

                  '&.Mui-selected:hover': {
                    backgroundColor: '#E1E7F2',
                  },

                  '&:hover': {
                    backgroundColor: '#F4F6FA',
                  },
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 34,
                    color:
                      activeSection === item.label
                        ? '#404D73'
                        : '#667085',
                  }}
                >
                  {item.icon}
                </ListItemIcon>

                <ListItemText
  primary={item.label}
  sx={{
    '& .MuiListItemText-primary': {
      fontSize: 13.5,
      fontWeight:
        activeSection === item.label ? 700 : 500,
    },
  }}
/>
              </ListItemButton>
            ))}
          </List>
        </Card>

        {/* RIGHT CONTENT */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            width: '100%',
          }}
        >
          {/* GENERAL */}
          {activeSection === 'General' && (
            <>
              <SectionHeading
                title="General Settings"
                description="Basic application and environment information."
              />

              <Card
                variant="outlined"
                sx={{
                  borderColor: '#E2E6EF',
                  boxShadow: 'none',
                }}
              >
                {[
                  ['Application', 'BLUEBERI'],
                  ['Platform', 'Accounts Payable Automation'],
                  ['Environment', 'Hackathon Demo'],
                  ['Dataset', 'Harborline Logistics (Synthetic)'],
                  ['Currency', 'CAD'],
                  ['Policy Configuration', 'Approval policies via Controller'],
                  ['Payment Execution', 'Simulation Only'],
                ].map(([label, value], index) => (
                  <Box key={label}>
                    {index > 0 && <Divider />}

                    <Stack
                      direction="row"
                      sx={{
                        px: 2.5,
                        py: 1.8,
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 2,
                      }}
                    >
                      <Typography
                        variant="body2"
                        sx={{ color: '#667085' }}
                      >
                        {label}
                      </Typography>

                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 600,
                          color: '#263451',
                          textAlign: 'right',
                        }}
                      >
                        {value}
                      </Typography>
                    </Stack>
                  </Box>
                ))}
              </Card>

              <Alert
                severity="info"
                icon={<InfoOutlinedIcon />}
                sx={{ mt: 3 }}
              >
                Reference settings are read-only. Approval policies are
                editable by the Controller and audited; departments are loaded
                from the API.
              </Alert>
            </>
          )}

          {/* APPROVALS */}
          {activeSection === 'Approvals' && (
            <>
              <SectionHeading
                title="Approval Policies"
                description="Manage the bounded routing policies evaluated on invoice submission."
              />

              <ApprovalPolicies user={user} />

              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 700,
                  color: '#263451',
                  mt: 4,
                  mb: 1.5,
                }}
              >
                Additional Approval Controls
              </Typography>

              <ControlList controls={additionalControls} />
            </>
          )}

          {/* PAYMENTS */}
          {activeSection === 'Payments' && (
            <>
              <SectionHeading
                title="Payment Controls"
                description="Review payment authorization and security requirements."
              />

              <Alert severity="info" sx={{ mb: 3 }}>
                Payment release limits are enforced by the payments API.
                They are not configured here; this table is reference only.
              </Alert>

              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 700,
                  color: '#263451',
                  mb: 1.5,
                }}
              >
                Payment Release Authorization
              </Typography>

              <PolicyTable policies={paymentPolicies} />

              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 700,
                  color: '#263451',
                  mb: 1.5,
                }}
              >
                Security Controls
              </Typography>

              <ControlList controls={paymentControls} />

              <Alert
                severity="warning"
                icon={<LockOutlinedIcon />}
                sx={{ mt: 3 }}
              >
                Invoice approval and payment release must be
                performed by different authorized users.
              </Alert>
            </>
          )}

          {/* DEPARTMENTS */}
          {activeSection === 'Departments' && (
            <>
              <SectionHeading
                title="Departments"
                description="Browse organizational departments and cost centres."
              />

              <TextField
                fullWidth
                size="small"
                placeholder="Search departments or cost centres..."
                value={departmentSearch}
                onChange={(event) =>
                  setDepartmentSearch(event.target.value)
                }
                sx={{
                  mb: 2,
                  backgroundColor: '#FFFFFF',
                }}
                slotProps={{
  input: {
    startAdornment: (
      <InputAdornment position="start">
        <SearchIcon
          sx={{ color: '#98A2B3', fontSize: 20 }}
        />
      </InputAdornment>
    ),
  },
}}
              />

              {departmentsLoading ? (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    p: 3,
                  }}
                >
                  <CircularProgress size={20} />

                  <Typography color="text.secondary">
                    Loading departments...
                  </Typography>
                </Box>
              ) : departmentsError ? (
                <Alert
                  severity="error"
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      onClick={retryDepartments}
                    >
                      Retry
                    </Button>
                  }
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Could not load departments ({departmentsError.code})
                  </Typography>

                  <Typography variant="body2">
                    {departmentsError.message}
                  </Typography>
                </Alert>
              ) : (
                <>
                  <TableContainer
                    component={Card}
                    variant="outlined"
                    sx={{
                      borderColor: '#E2E6EF',
                      boxShadow: 'none',
                    }}
                  >
                    <Table size="small">
                      <TableHead
                        sx={{ backgroundColor: '#F4F6FA' }}
                      >
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700 }}>
                            Department
                          </TableCell>

                          <TableCell sx={{ fontWeight: 700 }}>
                            Cost Centre
                          </TableCell>

                          <TableCell
                            align="right"
                            sx={{ fontWeight: 700 }}
                          >
                            Annual Budget
                          </TableCell>
                        </TableRow>
                      </TableHead>

                      <TableBody>
                        {filteredDepartments.map((department) => (
                          <TableRow key={department.id} hover>
                            <TableCell
                              sx={{
                                fontWeight: 600,
                                color: '#263451',
                                py: 1.8,
                              }}
                            >
                              {department.name}
                            </TableCell>

                            <TableCell sx={{ color: '#667085' }}>
                              {department.cost_centre ?? '—'}
                            </TableCell>

                            <TableCell
                              align="right"
                              sx={{
                                fontWeight: 600,
                                color: '#404D73',
                              }}
                            >
                              {department.annual_budget_cad
                                ? `CAD ${department.annual_budget_cad}`
                                : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  {filteredDepartments.length === 0 && (
                    <Typography
                      variant="body2"
                      sx={{
                        textAlign: 'center',
                        color: '#667085',
                        mt: 3,
                      }}
                    >
                      No departments match your search.
                    </Typography>
                  )}
                </>
              )}
            </>
          )}
        </Box>
      </Stack>
    </Box>
  )
}