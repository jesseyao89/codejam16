import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

type PaymentStatus = 'Ready' | 'Processing' | 'Paid' | 'On Hold'

type Payment = {
  id: string
  invoiceId: string
  vendor: string
  amount: number
  dueDate: string
  method: string
  status: PaymentStatus
  approved: boolean
}

const initialPayments: Payment[] = [
  {
    id: 'PAY-001',
    invoiceId: 'AP-00002',
    vendor: 'Northstar Supplies',
    amount: 1250,
    dueDate: '2026-12-05',
    method: 'EFT',
    status: 'Ready',
    approved: true,
  },
  {
    id: 'PAY-002',
    invoiceId: 'AP-00004',
    vendor: 'Northern Logistics',
    amount: 8750,
    dueDate: '2026-12-10',
    method: 'EFT',
    status: 'Processing',
    approved: true,
  },
  {
    id: 'PAY-003',
    invoiceId: 'AP-00008',
    vendor: 'Alpenglow Events',
    amount: 3200,
    dueDate: '2026-11-30',
    method: 'EFT',
    status: 'Paid',
    approved: true,
  },
  {
    id: 'PAY-004',
    invoiceId: 'AP-00003',
    vendor: 'Summit Consulting',
    amount: 5400,
    dueDate: '2026-12-12',
    method: 'EFT',
    status: 'On Hold',
    approved: false,
  },
]

const statusColors: Record<
  PaymentStatus,
  { background: string; text: string }
> = {
  Ready: {
    background: '#E8EDFF',
    text: '#404D73',
  },
  Processing: {
    background: '#FFF0CC',
    text: '#B86B00',
  },
  Paid: {
    background: '#DCFCE7',
    text: '#166534',
  },
  'On Hold': {
    background: '#FDE7E7',
    text: '#B42318',
  },
}

const formatMoney = (amount: number) =>
  new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount)

export default function Payments() {
  const [payments, setPayments] = useState(initialPayments)
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(
    null
  )

  const readyCount = payments.filter(
    (payment) => payment.status === 'Ready'
  ).length

  const paidCount = payments.filter(
    (payment) => payment.status === 'Paid'
  ).length

  const outstandingAmount = payments
    .filter((payment) => payment.status !== 'Paid')
    .reduce((sum, payment) => sum + payment.amount, 0)

  const handleConfirm = () => {
    if (!selectedPayment) return

    if (
      selectedPayment.status !== 'Ready' ||
      !selectedPayment.approved
    ) {
      setSelectedPayment(null)
      return
    }

    setPayments((current) =>
      current.map((payment) =>
        payment.id === selectedPayment.id
          ? { ...payment, status: 'Paid' }
          : payment
      )
    )

    setSelectedPayment(null)
  }

  return (
    <Box>
      {/* HEADER */}
      <Card
        sx={{
          backgroundColor: '#404D73',
          color: '#FFFFFF',
          mb: 4,
          borderRadius: 3,
        }}
      >
        <CardContent sx={{ p: 4 }}>
          <Stack
  direction="row"
  spacing={2}
  sx={{ alignItems: 'center' }}
>
            <AccountBalanceWalletIcon sx={{ fontSize: 36 }} />

            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                Payment Management
              </Typography>

              <Typography sx={{ color: '#E0E5F0', mt: 0.5 }}>
                Track approved invoices and payment activity
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* DEMO NOTICE */}
      <Alert severity="info" sx={{ mb: 4 }}>
        Demo mode: Payment statuses are simulated and stored only in
        this browser session. No bank transfers or real payments
        are performed.
      </Alert>

      {/* SUMMARY CARDS */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={3}
        sx={{ mb: 4 }}
      >
        {[
          {
            label: 'Outstanding Amount',
            value: formatMoney(outstandingAmount),
            color: '#263451',
            icon: <AccountBalanceWalletIcon />,
          },
          {
            label: 'Ready for Payment',
            value: readyCount,
            color: '#404D73',
            icon: <AccessTimeIcon />,
          },
          {
            label: 'Payments Completed',
            value: paidCount,
            color: '#166534',
            icon: <CheckCircleIcon />,
          },
        ].map((item) => (
          <Card key={item.label} sx={{ flex: 1 }}>
            <CardContent sx={{ p: 3 }}>
              <Stack
  direction="row"
  sx={{
    justifyContent: 'space-between',
    alignItems: 'center',
  }}
>
                <Typography variant="body2" color="text.secondary">
                  {item.label}
                </Typography>

                <Box sx={{ color: item.color }}>{item.icon}</Box>
              </Stack>

              <Typography
                variant="h4"
                sx={{
                  fontWeight: 800,
                  color: item.color,
                  mt: 1,
                }}
              >
                {item.value}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {/* PAYMENT TABLE */}
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Typography
            variant="h6"
            sx={{ fontWeight: 700, color: '#263451', mb: 2 }}
          >
            Payment Queue
          </Typography>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  {[
                    'Payment ID',
                    'Invoice',
                    'Vendor',
                    'Amount',
                    'Due Date',
                    'Method',
                    'Status',
                    'Action',
                  ].map((heading) => (
                    <TableCell
                      key={heading}
                      sx={{
                        fontWeight: 700,
                        color: '#404D73',
                      }}
                    >
                      {heading}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>

              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id} hover>
                    <TableCell>{payment.id}</TableCell>

                    <TableCell>{payment.invoiceId}</TableCell>

                    <TableCell>{payment.vendor}</TableCell>

                    <TableCell sx={{ fontWeight: 700 }}>
                      {formatMoney(payment.amount)}
                    </TableCell>

                    <TableCell>{payment.dueDate}</TableCell>

                    <TableCell>{payment.method}</TableCell>

                    <TableCell>
                      <Chip
                        label={payment.status}
                        size="small"
                        sx={{
                          fontWeight: 700,
                          backgroundColor:
                            statusColors[payment.status].background,
                          color: statusColors[payment.status].text,
                        }}
                      />
                    </TableCell>

                    <TableCell>
                      {payment.status === 'Ready' &&
                      payment.approved ? (
                        <Button
                          variant="contained"
                          size="small"
                          onClick={() => setSelectedPayment(payment)}
                          sx={{
                            backgroundColor: '#404D73',
                            color: '#FFFFFF',
                            textTransform: 'none',
                            fontWeight: 700,
                            '&:hover': {
                              backgroundColor: '#354263',
                            },
                          }}
                        >
                          Record Payment
                        </Button>
                      ) : payment.status === 'On Hold' ? (
                        <Stack
  direction="row"
  spacing={0.5}
  sx={{ alignItems: 'center' }}
>
                          <WarningAmberIcon
                            sx={{ color: '#B42318', fontSize: 18 }}
                          />

                          <Typography
                            variant="body2"
                            sx={{ color: '#B42318' }}
                          >
                            Blocked
                          </Typography>
                        </Stack>
                      ) : (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                        >
                          —
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* CONFIRMATION DIALOG */}
      <Dialog
        open={selectedPayment !== null}
        onClose={() => setSelectedPayment(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle
          sx={{
            fontWeight: 700,
            color: '#263451',
          }}
        >
          Record Payment
        </DialogTitle>

        <DialogContent>
          <Typography sx={{ color: '#263451', mb: 2 }}>
            Are you sure you want to mark this invoice as paid?
          </Typography>

          {selectedPayment && (
            <Box
              sx={{
                backgroundColor: '#F4F6FA',
                p: 2,
                borderRadius: 2,
              }}
            >
              <Typography sx={{ color: '#263451' }}>
                <strong>Vendor:</strong> {selectedPayment.vendor}
              </Typography>

              <Typography sx={{ color: '#263451', mt: 1 }}>
                <strong>Invoice:</strong> {selectedPayment.invoiceId}
              </Typography>

              <Typography sx={{ color: '#263451', mt: 1 }}>
                <strong>Amount:</strong>{' '}
                {formatMoney(selectedPayment.amount)}
              </Typography>

              <Divider sx={{ my: 2 }} />

              <Typography variant="body2" sx={{ color: '#667085' }}>
                This action updates the demo payment status only.
                It does not initiate a bank transfer.
              </Typography>
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 3 }}>
          <Button
            onClick={() => setSelectedPayment(null)}
            sx={{
              color: '#404D73',
              fontWeight: 600,
            }}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={handleConfirm}
            sx={{
              backgroundColor: '#404D73',
              color: '#FFFFFF',
              fontWeight: 700,
              '&:hover': {
                backgroundColor: '#354263',
              },
            }}
          >
            Confirm Payment
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}