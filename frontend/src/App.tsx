import { useEffect, useState } from 'react'

import Approvals from './Approvals'
import AIReview from './AIReview'
import Payments from './Payments'
import Settings from './Settings'
import Login from './Login'

import EmailAssistant from './EmailAssistant'

import {
  authService,
  invoiceService,
  dashboardService,
  type User,
  type Invoice,
  type DashboardSummary,
} from './api/services'

import { getToken, clearToken } from './api/client'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  CssBaseline,
  Divider,
  Drawer,
  FormControl,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ThemeProvider,
  Typography,
  createTheme,
} from '@mui/material'

import AddIcon from '@mui/icons-material/Add'
import DashboardIcon from '@mui/icons-material/Dashboard'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import PaymentsIcon from '@mui/icons-material/Payments'
import SettingsIcon from '@mui/icons-material/Settings'
import RefreshIcon from '@mui/icons-material/Refresh'
import LogoutIcon from '@mui/icons-material/Logout'

import InvoiceDetails from './InvoiceDetails'
import InvoiceUpload from './InvoiceUpload'
import blueberiLogo from './blueberi-logo.png'

// --------------------------------------------------
// THEME
// --------------------------------------------------

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#404D73',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#C7F36B',
    },
    background: {
      default: '#F8F9FA',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#171717',
      secondary: '#667085',
    },
  },
  typography: {
    fontFamily: '"Inter", "Arial", sans-serif',
    h4: { fontWeight: 700 },
    h5: { fontWeight: 600 },
  },
  shape: {
    borderRadius: 12,
  },
})

// --------------------------------------------------
// MENU
// --------------------------------------------------

const menuItems = [
  { label: 'Dashboard', icon: <DashboardIcon /> },
  { label: 'Invoices', icon: <ReceiptLongIcon /> },
  { label: 'Approvals', icon: <FactCheckIcon /> },
  { label: 'AI Review', icon: <SmartToyIcon /> },
  { label: 'AI Email Assistant', icon: <SmartToyIcon /> },
  { label: 'Payments', icon: <PaymentsIcon /> },
  { label: 'Settings', icon: <SettingsIcon /> },
]

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function formatMoney(
  amount: string | null,
  currency: string | null
): string {
  if (amount === null) return '—'
  return `${currency ?? ''} ${amount}`.trim()
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ')
}

function getStatusColor(
  status: string
): 'success' | 'warning' | 'error' | 'info' | 'default' {
  switch (status) {
    case 'PAID':
    case 'APPROVED':
    case 'PASSED':
      return 'success'

    case 'REVIEW':
    case 'PENDING_APPROVAL':
    case 'WARNING':
      return 'warning'

    case 'BLOCKED':
    case 'REJECTED':
      return 'error'

    case 'DRAFT':
      return 'info'

    default:
      return 'default'
  }
}

// --------------------------------------------------
// SIDEBAR
// --------------------------------------------------

interface SidebarProps {
  currentPage: string
  setCurrentPage: (page: string) => void
  user: User
  onLogout: () => void
}

function Sidebar({
  currentPage,
  setCurrentPage,
  user,
  onLogout,
}: SidebarProps) {
  return (
    <Drawer
      variant="permanent"
      sx={{
        width: 240,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: 240,
          boxSizing: 'border-box',
          backgroundColor: '#59678F',
          color: '#FFFFFF',
          borderRight: 'none',
        },
      }}
    >
      <Box sx={{ px: 3, pt: 8, pb: 3 }}>
        <Stack
  direction="row"
  spacing={1.5}
  sx={{ alignItems: 'flex-start' }}
>
          <Box
            component="img"
            src={blueberiLogo}
            alt="BLUEBERI Logo"
            sx={{
              width: 40,
              height: 40,
              objectFit: 'contain',

              mt: 0.5,
            }}
          />

          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              BLUEBERI
            </Typography>

            <Typography variant="body2" sx={{ color: '#E0E5F0' }}>
              Invoice Automation
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Divider sx={{ borderColor: '#7784A5' }} />

      <List sx={{ px: 1 }}>
        {menuItems.map((item) => (
          <ListItemButton
            key={item.label}
            selected={item.label === currentPage}
            onClick={() => setCurrentPage(item.label)}
            sx={{
              borderRadius: 2,
              mb: 0.5,
              color: '#FFFFFF',
              '&.Mui-selected': {
                backgroundColor: '#404D73',
              },
              '&.Mui-selected:hover': {
                backgroundColor: '#354263',
              },
              '&:hover': {
                backgroundColor: '#6B789C',
              },
            }}
          >
            <ListItemIcon sx={{ color: '#FFFFFF', minWidth: 40 }}>
              {item.icon}
            </ListItemIcon>

            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>

      <Box sx={{ mt: 'auto', p: 2 }}>
        <Divider sx={{ borderColor: '#7784A5', mb: 2 }} />

        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {user.full_name}
        </Typography>

        <Typography variant="caption" sx={{ color: '#E0E5F0' }}>
          {formatStatus(user.role)}
        </Typography>

        <Button
          fullWidth
          variant="outlined"
          startIcon={<LogoutIcon />}
          onClick={onLogout}
          sx={{
            mt: 2,
            color: '#FFFFFF',
            borderColor: '#FFFFFF',
          }}
        >
          Log Out
        </Button>
      </Box>
    </Drawer>
  )
}

// --------------------------------------------------
// APP
// --------------------------------------------------

function App() {
  const [currentPage, setCurrentPage] = useState('Dashboard')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')

  const [selectedInvoiceId, setSelectedInvoiceId] =
    useState<string | null>(null)

  const [uploadOpen, setUploadOpen] = useState(false)

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [apiInvoices, setApiInvoices] = useState<Invoice[]>([])
  const [dashboard, setDashboard] =
    useState<DashboardSummary | null>(null)

  const [apiError, setApiError] = useState('')
  const [dataLoading, setDataLoading] = useState(false)

  // CHECK AUTHENTICATION

  useEffect(() => {
    async function checkAuth() {
      if (!getToken()) {
        setAuthLoading(false)
        return
      }

      try {
        const currentUser = await authService.me()
        setUser(currentUser)
      } catch {
        clearToken()
        setUser(null)
      } finally {
        setAuthLoading(false)
      }
    }

    void checkAuth()
  }, [])

  // FETCH DJANGO DATA

  useEffect(() => {
    if (!user) return

    async function loadData() {
      setDataLoading(true)
      setApiError('')

      try {
        const [invoiceResponse, dashboardResponse] =
          await Promise.all([
            invoiceService.list(),
            dashboardService.get(),
          ])

        setApiInvoices(invoiceResponse.results)
        setDashboard(dashboardResponse)
      } catch (err) {
        setApiError(
          err instanceof Error
            ? err.message
            : 'Failed to load data'
        )
      } finally {
        setDataLoading(false)
      }
    }

    void loadData()
  }, [user])

  // REFRESH DATA

  async function refreshData() {
    setDataLoading(true)
    setApiError('')

    try {
      const [invoiceResponse, dashboardResponse] =
        await Promise.all([
          invoiceService.list(),
          dashboardService.get(),
        ])

      setApiInvoices(invoiceResponse.results)
      setDashboard(dashboardResponse)
    } catch (err) {
      setApiError(
        err instanceof Error
          ? err.message
          : 'Failed to load data'
      )
    } finally {
      setDataLoading(false)
    }
  }

  // LOGOUT

  async function handleLogout() {
    try {
      await authService.logout()
    } catch {
      // Clear local session even if the request fails.
    } finally {
      clearToken()
      setUser(null)
      setApiInvoices([])
      setDashboard(null)
      setSelectedInvoiceId(null)
    }
  }

  // FILTER INVOICES

  const filteredInvoices = apiInvoices.filter((invoice) => {
    const query = searchQuery.trim().toLowerCase()

    const vendorName = invoice.vendor?.legal_name ?? ''
    const invoiceNumber = invoice.invoice_number ?? ''

    const matchesSearch =
      invoice.id.toLowerCase().includes(query) ||
      vendorName.toLowerCase().includes(query) ||
      invoiceNumber.toLowerCase().includes(query)

    const matchesStatus =
      statusFilter === 'All' ||
      invoice.status === statusFilter

    return matchesSearch && matchesStatus
  })

  // INVOICE DRAWER

  const selectedInvoice =
    apiInvoices.find(
      (invoice) => invoice.id === selectedInvoiceId
    ) ?? null

  const drawerInvoice = selectedInvoice
    ? {
      id: selectedInvoice.id,
      vendor: selectedInvoice.vendor?.legal_name ?? 'Unknown Vendor',
      amount: formatMoney(
        selectedInvoice.total,
        selectedInvoice.currency
      ),
      status: formatStatus(selectedInvoice.status),
    }
    : null

  // DASHBOARD CARDS

  const dashboardCards = [
    {
      label: 'Pending My Approval',
      value: dashboard?.counts.pending_my_approval ?? '—',
    },
    {
      label: 'In Review',
      value: dashboard?.counts.in_review ?? '—',
    },
    {
      label: 'Payments Due',
      value: dashboard?.counts.payments_due ?? '—',
    },
    {
      label: 'Open Findings',
      value: dashboard?.counts.open_findings ?? '—',
    },
  ]

  // AUTH LOADING

  if (authLoading) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <CircularProgress />
          <Typography>Loading BLUEBERI...</Typography>
        </Box>
      </ThemeProvider>
    )
  }

  // LOGIN

  if (!user) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Login onLogin={setUser} />
      </ThemeProvider>
    )
  }

  // MAIN UI

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      <Sidebar
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        user={user}
        onLogout={() => {
          void handleLogout()
        }}
      />

      <Box
        sx={{
          minHeight: '100vh',
          ml: '240px',
          py: 8,
        }}
      >
        <Container maxWidth="lg">
          {/* HEADER */}

          <Stack
            direction="row"
            sx={{
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 5,
            }}
          >
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
                {currentPage}
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1 }}
              >
                Welcome, {user.full_name}
              </Typography>
            </Box>

            <Stack direction="row" spacing={2}>
              {(currentPage === 'Dashboard' ||
                currentPage === 'Invoices') && (
                  <Button
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    disabled={dataLoading}
                    onClick={() => {
                      void refreshData()
                    }}
                  >
                    Refresh
                  </Button>
                )}

              {currentPage === 'Invoices' && (
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => setUploadOpen(true)}
                  sx={{
                    backgroundColor: '#404D73',
                    '&:hover': {
                      backgroundColor: '#354263',
                    },
                    textTransform: 'none',
                    fontWeight: 600,
                    px: 3,
                    py: 1.2,
                  }}
                >
                  Upload Invoice
                </Button>
              )}
            </Stack>
          </Stack>

          {/* API ERROR */}

          {apiError && (
            <Alert
              severity="error"
              sx={{ mb: 3 }}
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => {
                    void refreshData()
                  }}
                >
                  Retry
                </Button>
              }
            >
              {apiError}
            </Alert>
          )}

          {/* LOADING */}

          {dataLoading && (
            <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
              <CircularProgress size={20} />
              <Typography color="text.secondary">
                Loading data from Django...
              </Typography>
            </Box>
          )}

          {/* DASHBOARD */}

          {currentPage === 'Dashboard' && (
            <>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={3}
                sx={{ mb: 5 }}
              >
                {dashboardCards.map((item) => (
                  <Card key={item.label} sx={{ flex: 1 }}>
                    <CardContent>
                      <Typography color="text.secondary">
                        {item.label}
                      </Typography>

                      <Typography
                        variant="h3"
                        sx={{ fontWeight: 700 }}
                      >
                        {item.value}
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </Stack>

              <Typography variant="h6" sx={{ mb: 2 }}>
                Recent Invoices
              </Typography>
            </>
          )}

          {/* INVOICE FILTERS */}

          {currentPage === 'Invoices' && (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ mb: 3 }}
            >
              <TextField
                fullWidth
                size="small"
                placeholder="Search invoices by ID, number or vendor..."
                value={searchQuery}
                onChange={(event) =>
                  setSearchQuery(event.target.value)
                }
                sx={{ backgroundColor: '#FFFFFF' }}
              />

              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel>Status</InputLabel>

                <Select
                  label="Status"
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value)
                  }
                  sx={{ backgroundColor: '#FFFFFF' }}
                >
                  <MenuItem value="All">All Statuses</MenuItem>
                  <MenuItem value="DRAFT">Draft</MenuItem>
                  <MenuItem value="REVIEW">Review</MenuItem>
                  <MenuItem value="PENDING_APPROVAL">
                    Pending Approval
                  </MenuItem>
                  <MenuItem value="APPROVED">Approved</MenuItem>
                  <MenuItem value="PAID">Paid</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          )}

          {/* INVOICE TABLE */}

          {(currentPage === 'Dashboard' ||
            currentPage === 'Invoices') && (
              <>
                <TableContainer component={Card}>
                  <Table
                    sx={{
                      '& .MuiTableCell-root': {
                        border: '1px solid #D6DCE8',
                      },
                      '& .MuiTableHead-root': {
                        backgroundColor: '#E9EDF5',
                      },
                    }}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell>Invoice ID</TableCell>
                        <TableCell>Vendor</TableCell>
                        <TableCell>Invoice Number</TableCell>
                        <TableCell>Amount</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Validation</TableCell>
                      </TableRow>
                    </TableHead>

                    <TableBody>
                      {(currentPage === 'Dashboard'
                        ? apiInvoices.slice(0, 5)
                        : filteredInvoices
                      ).map((invoice) => (
                        <TableRow
                          key={invoice.id}
                          hover
                          onClick={() =>
                            setSelectedInvoiceId(invoice.id)
                          }
                          sx={{
                            cursor: 'pointer',
                            '&:hover': {
                              backgroundColor:
                                '#F0F3FA !important',
                            },
                          }}
                        >
                          <TableCell>{invoice.id}</TableCell>

                          <TableCell>
                            {invoice.vendor?.legal_name ??
                              'Unknown Vendor'}
                          </TableCell>

                          <TableCell>
                            {invoice.invoice_number ?? '—'}
                          </TableCell>

                          <TableCell>
                            {formatMoney(
                              invoice.total,
                              invoice.currency
                            )}
                          </TableCell>

                          <TableCell>
                            <Chip
                              label={formatStatus(invoice.status)}
                              color={getStatusColor(invoice.status)}
                              size="small"
                            />
                          </TableCell>

                          <TableCell>
                            <Chip
                              label={formatStatus(
                                invoice.validation_status
                              )}
                              color={getStatusColor(
                                invoice.validation_status
                              )}
                              size="small"
                              variant="outlined"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>

                {!dataLoading &&
                  filteredInvoices.length === 0 && (
                    <Typography
                      color="text.secondary"
                      sx={{ textAlign: 'center', mt: 3 }}
                    >
                      {apiError
                        ? 'Unable to load invoices.'
                        : 'No invoices found.'}
                    </Typography>
                  )}
              </>
            )}

          {/* OTHER PAGES */}

          {currentPage === 'Approvals' && <Approvals />}
          {currentPage === 'AI Review' && <AIReview />}
          {currentPage === 'AI Email Assistant' && <EmailAssistant />}
          {currentPage === 'Payments' && <Payments />}
          {currentPage === 'Settings' && <Settings />}

          {/* INVOICE DETAILS */}

          <InvoiceDetails
            invoice={drawerInvoice}
            onClose={() => setSelectedInvoiceId(null)}
          />

          {/* UPLOAD DIALOG */}

          <InvoiceUpload
            open={uploadOpen}
            onClose={() => {
              setUploadOpen(false)
              void refreshData()
            }}
          />
        </Container>
      </Box>
    </ThemeProvider>
  )
}

export default App