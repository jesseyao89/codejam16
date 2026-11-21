import {
  Box,
  Card,
  CardContent,
  TextField,
  Chip,
  Container,
  CssBaseline,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ThemeProvider,
  Typography,
  createTheme,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material'

import blueberiLogo from './blueberi-logo.png'

import { useState } from 'react'

import {
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material'

import DashboardIcon from '@mui/icons-material/Dashboard'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import PaymentsIcon from '@mui/icons-material/Payments'
import SettingsIcon from '@mui/icons-material/Settings'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#111827',
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

const menuItems = [
  { label: 'Dashboard', icon: <DashboardIcon /> },
  { label: 'Invoices', icon: <ReceiptLongIcon /> },
  { label: 'Approvals', icon: <FactCheckIcon /> },
  { label: 'AI Review', icon: <SmartToyIcon /> },
  { label: 'Payments', icon: <PaymentsIcon /> },
  { label: 'Settings', icon: <SettingsIcon /> },
]

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

      <Divider />

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
  sx={{
   color: '#FFFFFF',
  }}
/>
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  )
}

function App() {
  const [currentPage, setCurrentPage] = useState('Dashboard')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null)
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      <Sidebar
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
      />

      <Box
        sx={{
          minHeight: '100vh',
          ml: '240px',
          py: 8,
        }}
      >
        <Container maxWidth="lg">
         <Typography
  variant="h4"
  sx={{ fontWeight: 700, mb: 5 }}
>
  {currentPage}
</Typography>

          {(currentPage === 'Dashboard' || currentPage === 'Invoices') ? (
            <>
              {currentPage === 'Dashboard' && (
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={3}
                sx={{ mb: 5 }}
              >
                {[
                  { label: 'Total Invoices', value: 150 },
                  { label: 'Pending Approval', value: 24 },
                  { label: 'Flagged Invoices', value: 8 },
                ].map((item) => (
                  <Card key={item.label} sx={{ flex: 1 }}>
                    <CardContent>
                      <Typography color="text.secondary">
                        {item.label}
                      </Typography>

                      <Typography variant="h3" sx={{ fontWeight: 700 }}>
                        {item.value}
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
              )}
              {currentPage === 'Invoices' && (
  <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
    <TextField
      fullWidth
      size="small"
      placeholder="Search invoices by ID or vendor..."
      value={searchQuery}
      onChange={(event) => setSearchQuery(event.target.value)}
      sx={{ backgroundColor: '#FFFFFF' }}
    />

    <FormControl size="small" sx={{ minWidth: 180 }}>
      <InputLabel>Status</InputLabel>
      <Select
  label="Status"
  value={statusFilter}
  onChange={(event) => setStatusFilter(event.target.value)}
  sx={{ backgroundColor: '#FFFFFF' }}
>
        <MenuItem value="All">All Statuses</MenuItem>
        <MenuItem value="Pending Review">Pending Review</MenuItem>
        <MenuItem value="Approved">Approved</MenuItem>
        <MenuItem value="Flagged">Flagged</MenuItem>
      </Select>
    </FormControl>
  </Stack>
)}
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
                    {invoices
  .filter((invoice) => {
    if (currentPage !== 'Invoices') return true

    const matchesSearch =
      invoice.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      invoice.vendor.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesStatus =
      statusFilter === 'All' || invoice.status === statusFilter

    return matchesSearch && matchesStatus
  })
  .map((invoice) => (
                      <TableRow
  key={invoice.id}
  hover
  onClick={() => setSelectedInvoiceId(invoice.id)}
  sx={{
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: '#F0F3FA !important',
    },
  }}
>
                        <TableCell>{invoice.id}</TableCell>
                        <TableCell>{invoice.vendor}</TableCell>
                        <TableCell>{invoice.amount}</TableCell>
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
            </>
          ) : (
            <Card>
              <CardContent>
                <Typography variant="h6">
                  {currentPage}
                </Typography>
              </CardContent>
            </Card>
          )}
        <Dialog
  open={selectedInvoiceId !== null}
  onClose={() => setSelectedInvoiceId(null)}
  maxWidth="sm"
  fullWidth
>
  <DialogTitle>
    Invoice Details
  </DialogTitle>

  <DialogContent>
    <Typography variant="body1">
      Invoice ID: {selectedInvoiceId}
    </Typography>
  </DialogContent>

  <DialogActions>
    <Button onClick={() => setSelectedInvoiceId(null)}>
      Close
    </Button>
  </DialogActions>
</Dialog>
        </Container>
      </Box>
    </ThemeProvider>
  )
}

export default App