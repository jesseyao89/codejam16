import { useState } from 'react'

import {
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import AccessTimeIcon from '@mui/icons-material/AccessTime'

type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected'

type Approval = {
  id: string
  invoiceId: string
  vendor: string
  amount: string
  requestedBy: string
  status: ApprovalStatus
}

const initialApprovals: Approval[] = [
  {
    id: 'APR-001',
    invoiceId: 'AP-00001',
    vendor: 'Alpenglow Events',
    amount: '$2,520.00',
    requestedBy: 'Sarah Chen',
    status: 'Pending',
  },
  {
    id: 'APR-002',
    invoiceId: 'AP-00004',
    vendor: 'Northern Logistics',
    amount: '$8,750.00',
    requestedBy: 'James Wilson',
    status: 'Pending',
  },
  {
    id: 'APR-003',
    invoiceId: 'AP-00002',
    vendor: 'Northstar Supplies',
    amount: '$1,250.00',
    requestedBy: 'Emily Davis',
    status: 'Approved',
  },
]

export default function Approvals() {
  const [approvals, setApprovals] = useState(initialApprovals)
  
  const [demoRole, setDemoRole] = useState<
    'AP Clerk' | 'Manager' | 'Finance Admin'
  >('AP Clerk')

  const [selectedApproval, setSelectedApproval] =
    useState<Approval | null>(null)

  const [action, setAction] =
    useState<'Approved' | 'Rejected' | null>(null)

      const [accessDenied, setAccessDenied] = useState(false)

  const canApprove = demoRole !== 'AP Clerk'

  const handleApprovalAttempt = (
    approval: Approval,
    decision: 'Approved' | 'Rejected'
  ) => {
    if (!canApprove) {
      setAccessDenied(true)
      return
    }

    setSelectedApproval(approval)
    setAction(decision)
  }


  const pendingCount = approvals.filter(
    (approval) => approval.status === 'Pending'
  ).length

  const approvedCount = approvals.filter(
    (approval) => approval.status === 'Approved'
  ).length

  const rejectedCount = approvals.filter(
    (approval) => approval.status === 'Rejected'
  ).length

  const closeDialog = () => {
    setSelectedApproval(null)
    setAction(null)
  }

  const handleConfirm = () => {
    if (!selectedApproval || !action) return

    setApprovals((previous) =>
      previous.map((approval) =>
        approval.id === selectedApproval.id
          ? { ...approval, status: action }
          : approval
      )
    )

    closeDialog()
  }

  return (
    <Box>
      {/* DEMO NOTICE */}
            {/* DEMO ACCOUNT SWITCHER */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 3 }}>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>Demo Account</InputLabel>
          <Select
            value={demoRole}
            label="Demo Account"
            onChange={(event) =>
              setDemoRole(event.target.value as typeof demoRole)
            }
          >
            <MenuItem value="AP Clerk">👤 AP Clerk</MenuItem>
            <MenuItem value="Manager">👔 Manager</MenuItem>
            <MenuItem value="Finance Admin">🔐 Finance Admin</MenuItem>
          </Select>
        </FormControl>
      </Box>
      <Box
        sx={{
          mb: 3,
          p: 2,
          backgroundColor: '#EEF1F7',
          borderRadius: 2,
          border: '1px solid #D6DCE8',
        }}
      >
        <Typography variant="body2" sx={{ color: '#404D73' }}>
          Demo mode: Approval decisions are stored locally and
          are not submitted to the backend.
        </Typography>
      </Box>

      {/* SUMMARY CARDS */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={3}
        sx={{ mb: 4 }}
      >
        {[
          {
            label: 'Pending Approvals',
            value: pendingCount,
            color: '#404D73',
          },
          {
            label: 'Approved',
            value: approvedCount,
            color: '#2E7D4F',
          },
          {
            label: 'Rejected',
            value: rejectedCount,
            color: '#B54747',
          },
        ].map((item) => (
          <Card key={item.label} sx={{ flex: 1, p: 3 }}>
            <Typography color="text.secondary">
              {item.label}
            </Typography>

            <Typography
              variant="h3"
              sx={{
                fontWeight: 700,
                color: item.color,
                mt: 1,
              }}
            >
              {item.value}
            </Typography>
          </Card>
        ))}
      </Stack>

      {/* APPROVAL QUEUE */}
      <Card>
        <Box sx={{ p: 3 }}>
          <Typography
            variant="h6"
            sx={{ fontWeight: 700, color: '#263451' }}
          >
            Approval Queue
          </Typography>

          <Typography variant="body2" color="text.secondary">
            Review invoices awaiting authorization.
          </Typography>
        </Box>

        <TableContainer>
          <Table>
            <TableHead sx={{ backgroundColor: '#E9EDF5' }}>
              <TableRow>
                <TableCell>Invoice</TableCell>
                <TableCell>Vendor</TableCell>
                <TableCell>Amount</TableCell>
                <TableCell>Requested By</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {approvals.map((approval) => (
                <TableRow key={approval.id} hover>
                  <TableCell>{approval.invoiceId}</TableCell>

                  <TableCell>{approval.vendor}</TableCell>

                  <TableCell>{approval.amount}</TableCell>

                  <TableCell>{approval.requestedBy}</TableCell>

                  <TableCell>
                    <Chip
                      size="small"
                      icon={
                        approval.status === 'Approved' ? (
                          <CheckCircleIcon />
                        ) : approval.status === 'Rejected' ? (
                          <CancelIcon />
                        ) : (
                          <AccessTimeIcon />
                        )
                      }
                      label={approval.status}
                      sx={{
                        fontWeight: 600,
                        backgroundColor:
                          approval.status === 'Approved'
                            ? '#C5E3CD'
                            : approval.status === 'Rejected'
                              ? '#EFC2C2'
                              : '#F5DFA8',
                      }}
                    />
                  </TableCell>

                  <TableCell align="right">
                    {approval.status === 'Pending' ? (
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{
                          justifyContent: 'flex-end',
                        }}
                      >
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => handleApprovalAttempt(approval, 'Approved')}
                          sx={{
                            backgroundColor: '#2E7D4F',
                            '&:hover': {
                              backgroundColor: '#24643F',
                            },
                          }}
                        >
                          Approve
                        </Button>

                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={() => {
                            setSelectedApproval(approval)
                            setAction('Rejected')
                          }}
                        >
                          Reject
                        </Button>
                      </Stack>
                    ) : (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                      >
                        Completed
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      {/* ACCESS DENIED DIALOG */}
      <Dialog
        open={accessDenied}
        onClose={() => setAccessDenied(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ color: '#B54747', fontWeight: 700 }}>
          🔒 Access Denied
        </DialogTitle>

        <DialogContent>
          <Typography>
            Your current role ({demoRole}) does not have permission
            to approve invoices.
          </Typography>
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setAccessDenied(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
      {/* CONFIRMATION DIALOG */}
      <Dialog
        open={selectedApproval !== null}
        onClose={closeDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle
  sx={{
    fontWeight: 700,
    color: '#263451',
    fontSize: '1.3rem',
  }}
>
          {action === 'Approved'
            ? 'Confirm Approval'
            : 'Confirm Rejection'}
        </DialogTitle>

        <DialogContent>
  <Typography
    sx={{
      color: '#263451',
      fontWeight: 500,
    }}
  >
            Are you sure you want to{' '}
            {action === 'Approved' ? 'approve' : 'reject'} invoice{' '}
            <strong>{selectedApproval?.invoiceId}</strong>?
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 2 }}
          >
            This is a demo action. No real approval will be recorded.
          </Typography>
        </DialogContent>

        <DialogActions sx={{ p: 3 }}>
          <Button onClick={closeDialog}>
            Cancel
          </Button>

          <Button
            variant="contained"
            color={action === 'Rejected' ? 'error' : 'primary'}
            onClick={handleConfirm}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}