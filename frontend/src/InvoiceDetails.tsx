import { useState } from 'react'

import {
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'

import CloseIcon from '@mui/icons-material/Close'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import HistoryIcon from '@mui/icons-material/History'

type Invoice = {
  id: string
  vendor: string
  amount: string
  status: string
}

type Props = {
  invoice: Invoice | null
  onClose: () => void
}

// Temporary demo data until the Django API is connected
const mockLines = [
  {
    description: 'Professional services',
    quantity: 2,
    unitPrice: 1000,
    glAccount: 'Professional Fees',
  },
  {
    description: 'Administrative expenses',
    quantity: 1,
    unitPrice: 520,
    glAccount: 'Office Expenses',
  },
]

const glOptions = [
  'Professional Fees',
  'Office Expenses',
  'Travel Expenses',
  'Software',
]

export default function InvoiceDetails({ invoice, onClose }: Props) {
  const [activeTab, setActiveTab] = useState(0)

  const [glAccounts, setGlAccounts] = useState(
    mockLines.map((line) => line.glAccount)
  )

  const handleClose = () => {
    setActiveTab(0)
    onClose()
  }

  return (
    <Drawer
      anchor="right"
      open={invoice !== null}
      onClose={handleClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100%', sm: 600 },
            maxWidth: '100vw',
            backgroundColor: '#FFFFFF',
          },
        },
      }}
    >
      {invoice && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
          }}
        >
          {/* HEADER */}
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
              <Box>
                <Typography
                  variant="overline"
                  sx={{
                    color: '#DDE4F5',
                    letterSpacing: 1.5,
                  }}
                >
                  BLUEBERI / INVOICES
                </Typography>

                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 700,
                    mt: 1,
                  }}
                >
                  {invoice.id}
                </Typography>

                <Typography
                  sx={{
                    color: '#E0E5F0',
                    mt: 0.5,
                  }}
                >
                  {invoice.vendor}
                </Typography>
              </Box>

              <IconButton
                onClick={handleClose}
                sx={{ color: '#FFFFFF' }}
                aria-label="Close invoice details"
              >
                <CloseIcon />
              </IconButton>
            </Stack>
          </Box>

          {/* AMOUNT AND STATUS */}
          <Box sx={{ px: 4, py: 3 }}>
            <Stack
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Box>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#667085',
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}
                >
                  TOTAL AMOUNT
                </Typography>

                <Typography
                  variant="h4"
                  sx={{
                    fontWeight: 800,
                    color: '#263451',
                    mt: 0.5,
                  }}
                >
                  {invoice.amount}
                </Typography>
              </Box>

              <Chip
                label={invoice.status}
                sx={{
                  fontWeight: 700,
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
                }}
              />
            </Stack>
          </Box>

          {/* NAVIGATION TABS */}
          <Tabs
            value={activeTab}
            onChange={(_, value: number) => setActiveTab(value)}
            sx={{
              px: 3,
              borderBottom: '1px solid #E5E7EB',

              '& .MuiTab-root': {
                textTransform: 'none',
                fontWeight: 600,
              },

              '& .Mui-selected': {
                color: '#404D73 !important',
              },

              '& .MuiTabs-indicator': {
                backgroundColor: '#404D73',
              },
            }}
          >
            <Tab label="Overview" />
            <Tab label="AI Review" />
            <Tab label="Activity" />
          </Tabs>

          {/* MAIN CONTENT */}
          <Box
            sx={{
              flex: 1,
              overflowY: 'auto',
              px: 4,
              py: 3,
            }}
          >
            {/* OVERVIEW TAB */}
            {activeTab === 0 && (
              <Stack spacing={3}>
                <Box>
                  <Typography
                    sx={{
                      fontWeight: 700,
                      color: '#263451',
                      mb: 2,
                    }}
                  >
                    Line Items
                  </Typography>

                  <Table size="small">
                    <TableHead>
                      <TableRow
                        sx={{
                          backgroundColor: '#EEF1F7',
                        }}
                      >
                        <TableCell sx={{ fontWeight: 700 }}>
                          Description
                        </TableCell>

                        <TableCell sx={{ fontWeight: 700 }}>
                          Amount
                        </TableCell>

                        <TableCell sx={{ fontWeight: 700 }}>
                          GL Account
                        </TableCell>
                      </TableRow>
                    </TableHead>

                    <TableBody>
                      {mockLines.map((line, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 600 }}
                            >
                              {line.description}
                            </Typography>

                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Qty: {line.quantity}
                            </Typography>
                          </TableCell>

                          <TableCell>
                            $
                            {(
                              line.quantity * line.unitPrice
                            ).toFixed(2)}
                          </TableCell>

                          <TableCell>
                            <TextField
                              select
                              size="small"
                              value={glAccounts[index]}
                              onChange={(event) => {
                                const updated = [...glAccounts]
                                updated[index] = event.target.value
                                setGlAccounts(updated)
                              }}
                              sx={{ minWidth: 150 }}
                            >
                              {glOptions.map((option) => (
                                <MenuItem
                                  key={option}
                                  value={option}
                                >
                                  {option}
                                </MenuItem>
                              ))}
                            </TextField>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>

                <Divider />

                <Typography
                  variant="caption"
                  color="text.secondary"
                >
                  Demo line items and GL accounts. Changes are not
                  saved until the backend is connected.
                </Typography>
              </Stack>
            )}

            {/* AI REVIEW TAB */}
            {activeTab === 1 && (
              <Stack spacing={3}>
                <Typography
                  sx={{
                    fontWeight: 700,
                    color: '#263451',
                  }}
                >
                  Validation Summary
                </Typography>

                <Stack
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: 'center' }}
                >
                  <CheckCircleIcon
                    sx={{ color: '#2E7D4F' }}
                  />

                  <Box>
                    <Typography sx={{ fontWeight: 600 }}>
                      Invoice extraction complete
                    </Typography>

                    <Typography
                      variant="caption"
                      color="text.secondary"
                    >
                      Demo result
                    </Typography>
                  </Box>
                </Stack>

                <Divider />

                <Stack
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: 'center' }}
                >
                  <WarningAmberIcon
                    sx={{ color: '#B7791F' }}
                  />

                  <Box>
                    <Typography sx={{ fontWeight: 600 }}>
                      Possible duplicate detected
                    </Typography>

                    <Typography
                      variant="caption"
                      color="text.secondary"
                    >
                      Demo warning — requires review
                    </Typography>
                  </Box>
                </Stack>

                <Divider />

                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  Actual validation findings will be loaded from
                  the Django API.
                </Typography>
              </Stack>
            )}

            {/* ACTIVITY TAB */}
            {activeTab === 2 && (
              <Stack spacing={2}>
                <HistoryIcon
                  sx={{
                    color: '#59678F',
                    fontSize: 32,
                  }}
                />

                <Typography
                  sx={{
                    fontWeight: 700,
                    color: '#263451',
                  }}
                >
                  Activity History
                </Typography>

                <Typography
                  variant="body2"
                  color="text.secondary"
                >
                  No activity records loaded yet. Approval
                  decisions and audit events will appear here
                  when connected to the backend.
                </Typography>
              </Stack>
            )}
          </Box>

          {/* FOOTER */}
          <Box
            sx={{
              px: 4,
              py: 2.5,
              borderTop: '1px solid #E5E7EB',
              backgroundColor: '#FFFFFF',
            }}
          >
            <Stack
              direction="row"
              spacing={1.5}
              sx={{
                justifyContent: 'flex-end',
                flexWrap: 'wrap',
              }}
            >
              <Button
                onClick={handleClose}
                sx={{ color: '#404D73' }}
              >
                Close
              </Button>

              <Button
                variant="outlined"
                disabled
              >
                Save Review
              </Button>

              <Button
                variant="contained"
                disabled
              >
                Submit for Approval
              </Button>
            </Stack>
          </Box>
        </Box>
      )}
    </Drawer>
  )
}