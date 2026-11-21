import {
  Box,
  Card,
  CardContent,
  Chip,
  Container,
  CssBaseline,
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
} from '@mui/material'

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
  backgroundColor: '#171B24',
  color: '#FFFFFF',
  borderRight: 'none',
},
      }}
    >
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Brim AP
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Automation Platform
        </Typography>
      </Box>

      <Divider />

      <List sx={{ px: 1 }}>
        {menuItems.map((item) => (
          <ListItemButton
            key={item.label}
            selected={item.label === currentPage}
            onClick={() => setCurrentPage(item.label)}
            sx={{ borderRadius: 3, mb: 0.5 }}
          >
            <ListItemIcon
  sx={{
    color: item.label === currentPage ? '#C7F36B' : '#D1D5DB',
    minWidth: 40,
  }}
>
  {item.icon}
</ListItemIcon>
            <ListItemText
  primary={item.label}
  sx={{
    color: item.label === currentPage ? '#C7F36B' : '#FFFFFF',
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
          py: 5,
        }}
      >
        <Container maxWidth="lg">
          <Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>
            {currentPage}
          </Typography>

          <Typography color="text.secondary" sx={{ mb: 4 }}>
            AI-powered accounts payable management
          </Typography>

          <Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>
            Dashboard
          </Typography>

          {currentPage === 'Dashboard' ? (
            <>
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

              <TableContainer component={Card}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Invoice ID</TableCell>
                      <TableCell>Vendor</TableCell>
                      <TableCell>Amount</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>

                  <TableBody>
                    {invoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell>{invoice.id}</TableCell>
                        <TableCell>{invoice.vendor}</TableCell>
                        <TableCell>{invoice.amount}</TableCell>
                        <TableCell>
                          <Chip
                            label={invoice.status}
                            color={
                              invoice.status === 'Approved'
                                ? 'success'
                                : invoice.status === 'Flagged'
                                  ? 'error'
                                  : 'warning'
                            }
                            size="small"
                          />
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
                <Typography color="text.secondary">
                  This page is under development.
                </Typography>
              </CardContent>
            </Card>
          )}
        </Container>
      </Box>
    </ThemeProvider>
  )
}

export default App