import { useState } from 'react'

import Approvals from './Approvals'

import AIReview from './AIReview'

import Payments from './Payments'

import Settings from './Settings'

import {
  Box,
  Button,
  Card,
  CardContent,
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
    h4: {
      fontWeight: 700,
    },
    h5: {
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 12,
  },
})

// --------------------------------------------------
// MOCK DATA
// Replace with Django API data later
// --------------------------------------------------

const invoices = [
  {
    id: 'AP-00001',
    vendor: 'Alpenglow Events',
    amount: '$2,520.00',
    status: 'Pending Review',
  },
  {
    id: 'AP-00002',
    vendor: 'Northstar Supplies',
    amount: '$1,250.00',
    status: 'Approved',
  },
  {
    id: 'AP-00003',
    vendor: 'Summit Consulting',
    amount: '$5,400.00',
    status: 'Flagged',
  },
]

// --------------------------------------------------
// SIDEBAR MENU
// --------------------------------------------------

const menuItems = [
  { label: 'Dashboard', icon: <DashboardIcon /> },
  { label: 'Invoices', icon: <ReceiptLongIcon /> },
  { label: 'Approvals', icon: <FactCheckIcon /> },
  { label: 'AI Review', icon: <SmartToyIcon /> },
  { label: 'Payments', icon: <PaymentsIcon /> },
  { label: 'Settings', icon: <SettingsIcon /> },
]

// --------------------------------------------------
// SIDEBAR COMPONENT
// --------------------------------------------------

function Sidebar({
  currentPage,
  setCurrentPage,
}: {
  currentPage: string
  setCurrentPage: (page: string) => void
}) {
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
      {/* LOGO */}
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
            <Typography
              variant="h6"
              sx={{ fontWeight: 700 }}
            >
              BLUEBERI
            </Typography>

            <Typography
              variant="body2"
              sx={{ color: '#E0E5F0' }}
            >
              Invoice Automation
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Divider sx={{ borderColor: '#7784A5' }} />

      {/* NAVIGATION */}
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
            <ListItemIcon
              sx={{
                color: '#FFFFFF',
                minWidth: 40,
              }}
            >
              {item.icon}
            </ListItemIcon>

            <ListItemText
              primary={item.label}
              sx={{ color: '#FFFFFF' }}
            />
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  )
}

// --------------------------------------------------
// MAIN APPLICATION
// --------------------------------------------------

function App() {
  const [currentPage, setCurrentPage] = useState('Dashboard')

  const [searchQuery, setSearchQuery] = useState('')

  const [statusFilter, setStatusFilter] = useState('All')

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<
    string | null
  >(null)

  const [uploadOpen, setUploadOpen] = useState(false)

  // Filter invoices for the Invoices page
  const filteredInvoices = invoices.filter((invoice) => {
    if (currentPage !== 'Invoices') {
      return true
    }

    const query = searchQuery.trim().toLowerCase()

    const matchesSearch =
      invoice.id.toLowerCase().includes(query) ||
      invoice.vendor.toLowerCase().includes(query)

    const matchesStatus =
      statusFilter === 'All' ||
      invoice.status === statusFilter

    return matchesSearch && matchesStatus
  })

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      {/* SIDEBAR */}
      <Sidebar
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
      />

      {/* MAIN CONTENT */}
      <Box
        sx={{
          minHeight: '100vh',
          ml: '240px',
          py: 8,
        }}
      >
        <Container maxWidth="lg">

          {/* PAGE HEADER */}
          <Stack
            direction="row"
            sx={{
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 5,
            }}
          >
            <Typography
              variant="h4"
              sx={{ fontWeight: 700 }}
            >
              {currentPage}
            </Typography>

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

          {/* DASHBOARD AND INVOICES */}
          {currentPage === 'Dashboard' ||
          currentPage === 'Invoices' ? (
            <>

              {/* DASHBOARD STATISTICS */}
              {currentPage === 'Dashboard' && (
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={3}
                  sx={{ mb: 5 }}
                >
                  {[
                    {
                      label: 'Total Invoices',
                      value: 150,
                    },
                    {
                      label: 'Pending Approval',
                      value: 24,
                    },
                    {
                      label: 'Flagged Invoices',
                      value: 8,
                    },
                  ].map((item) => (
                    <Card
                      key={item.label}
                      sx={{ flex: 1 }}
                    >
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
              )}

              {/* SEARCH AND FILTER */}
              {currentPage === 'Invoices' && (
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={2}
                  sx={{ mb: 3 }}
                >
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Search invoices by ID or vendor..."
                    value={searchQuery}
                    onChange={(event) =>
                      setSearchQuery(event.target.value)
                    }
                    sx={{
                      backgroundColor: '#FFFFFF',
                    }}
                  />

                  <FormControl
                    size="small"
                    sx={{ minWidth: 180 }}
                  >
                    <InputLabel>Status</InputLabel>

                    <Select
                      label="Status"
                      value={statusFilter}
                      onChange={(event) =>
                        setStatusFilter(event.target.value)
                      }
                      sx={{
                        backgroundColor: '#FFFFFF',
                      }}
                    >
                      <MenuItem value="All">
                        All Statuses
                      </MenuItem>

                      <MenuItem value="Pending Review">
                        Pending Review
                      </MenuItem>

                      <MenuItem value="Approved">
                        Approved
                      </MenuItem>

                      <MenuItem value="Flagged">
                        Flagged
                      </MenuItem>
                    </Select>
                  </FormControl>
                </Stack>
              )}

              {/* INVOICE TABLE */}
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
                      <TableCell>Amount</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>

                  <TableBody>
                    {filteredInvoices.map((invoice) => (
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
                        <TableCell>
                          {invoice.id}
                        </TableCell>

                        <TableCell>
                          {invoice.vendor}
                        </TableCell>

                        <TableCell>
                          {invoice.amount}
                        </TableCell>

                        <TableCell
                          sx={{
                            backgroundColor:
                              invoice.status === 'Approved'
                                ? '#C5E3CD'
                                : invoice.status === 'Flagged'
                                  ? '#EFC2C2'
                                  : '#F5DFA8',

                            color:
                              invoice.status === 'Approved'
                                ? '#376B48'
                                : invoice.status === 'Flagged'
                                  ? '#A34A4A'
                                  : '#926B24',

                            fontWeight: 600,
                            textAlign: 'center',
                          }}
                        >
                          {invoice.status}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* EMPTY SEARCH RESULTS */}
              {filteredInvoices.length === 0 && (
                <Typography
                  color="text.secondary"
                  sx={{
                    textAlign: 'center',
                    mt: 3,
                  }}
                >
                  No invoices match your search.
                </Typography>
              )}
            </>
         ) : currentPage === 'Approvals' ? (
  <Approvals />
) : currentPage === 'AI Review' ? (
  <AIReview />
) : currentPage === 'Payments' ? (
  <Payments />
) : currentPage === 'Settings' ? (
  <Settings />
) : (
  // OTHER PAGES (PLACEHOLDERS)
  <Card>
              <CardContent>
                <Typography variant="h6">
                  {currentPage}
                </Typography>

                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 1 }}
                >
                  This page is under development.
                </Typography>
              </CardContent>
            </Card>
          )}

          {/* INVOICE DETAILS DRAWER */}
          <InvoiceDetails
            invoice={
              invoices.find(
                (invoice) =>
                  invoice.id === selectedInvoiceId
              ) ?? null
            }
            onClose={() =>
              setSelectedInvoiceId(null)
            }
          />

          {/* INVOICE UPLOAD DIALOG */}
          <InvoiceUpload
            open={uploadOpen}
            onClose={() =>
              setUploadOpen(false)
            }
          />

        </Container>
      </Box>
    </ThemeProvider>
  )
}

export default App