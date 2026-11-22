import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
  TextField,
} from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import EmailIcon from '@mui/icons-material/Email'
import AttachFileIcon from '@mui/icons-material/AttachFile'

interface InboxEmail {
  email_id: string
  from_name: string
  from_address: string
  subject: string
  body: string
  attachments: string[]
}

export default function EmailAssistant() {
  const [scanning, setScanning] = useState(false)
  const [scanComplete, setScanComplete] = useState(false)
  const [emails, setEmails] = useState<InboxEmail[]>([])
  const [selectedEmail, setSelectedEmail] = useState<InboxEmail | null>(null)
  const invoiceEmails = emails.filter((email) =>
  email.attachments.some((file: string) =>
    /\.(pdf|png|jpg|jpeg)$/i.test(file)
  )
)

const missingAttachments = emails.filter((email) =>
  email.attachments.length === 0 &&
  /invoice attached|facture ci-jointe/i.test(email.subject + ' ' + email.body)
)

const paymentInquiries = emails.filter((email) =>
  email.attachments.length === 0 &&
  /where is payment|payment status/i.test(email.subject + ' ' + email.body)
)

// ADD THIS HERE 👇
const irrelevantEmails = emails.filter((email) =>
  /sale|discount|promotion|newsletter|special offer/i.test(
    email.subject
  )
)


  async function scanInbox() {
  setScanning(true)
  setScanComplete(false)

  try {
    const response = await fetch('/emails.json')

    if (!response.ok) {
      throw new Error('Failed to load inbox')
    }

    const data = await response.json()
    setEmails(data)

    setScanComplete(true)
  } catch (error) {
    console.error('Inbox scan failed:', error)
    alert('Could not load the email dataset.')
  } finally {
    setScanning(false)
  }
}
  return (
    <Box>
      <Card sx={{ mb: 3, borderRadius: 3 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
            <AutoAwesomeIcon sx={{ color: '#59678F', fontSize: 36 }} />

            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                AI-Powered Inbox
              </Typography>

              <Typography color="text.secondary">
                Automatically discover invoice emails and prepare vendor replies.
              </Typography>
            </Box>
          </Stack>

          <Chip
            label="Hackathon Dataset Demo"
            color="info"
            variant="outlined"
            sx={{ mb: 3 }}
          />

          <Box>
            <Button
              variant="contained"
              size="large"
              startIcon={
                scanning ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <EmailIcon />
                )
              }
              disabled={scanning}
              onClick={scanInbox}
              sx={{ textTransform: 'none', px: 4 }}
            >
              {scanning ? 'Scanning Inbox...' : 'Scan Inbox'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {scanning && (
        <Alert severity="info" sx={{ mb: 3 }}>
          Simulating inbox scan...
        </Alert>
      )}

      {scanComplete && (
        <Card sx={{ borderRadius: 3 }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
              Scan Complete
            </Typography>

            <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap', gap: 1 }}>
  <Chip
    label={`${invoiceEmails.length} Potential Invoice Emails`}
    color="success"
  />

  <Chip
    label={`${missingAttachments.length} Missing Attachments`}
    color="warning"
  />

  <Chip
    label={`${paymentInquiries.length} Payment Inquiries`}
    color="info"
  />
</Stack>

            <Alert severity="success" sx={{ mb: 3 }}>
              Successfully scanned {emails.length} emails from Harborline Logistics' AP inbox.
            </Alert>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
  Payment Inquiries
</Typography>

<Stack spacing={2} sx={{ mb: 3 }}>
  {paymentInquiries.map((email) => (
    <Card key={email.email_id} variant="outlined">
      <CardContent>
        <Typography sx={{ fontWeight: 700 }}>
          {email.from_name}
        </Typography>

        <Typography variant="body2" sx={{ mb: 1 }}>
          {email.subject}
        </Typography>

        <Chip
          label="Payment Status Review Required"
          color="info"
          size="small"
        />
      </CardContent>
    </Card>
  ))}
</Stack>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
  Ignored Promotional Emails
</Typography>

<Stack spacing={2} sx={{ mb: 3 }}>
  {irrelevantEmails.map((email) => (
    <Card key={email.email_id} variant="outlined">
      <CardContent>
        <Typography sx={{ fontWeight: 700 }}>
          {email.from_name}
        </Typography>

        <Typography variant="body2" sx={{ mb: 1 }}>
          {email.subject}
        </Typography>

        <Chip
          label="Promotion - Not an Invoice"
          color="default"
          size="small"
        />
      </CardContent>
    </Card>
  ))}
</Stack>

<Stack spacing={2} sx={{ mb: 3 }}>
  {missingAttachments.map((email) => (
    <Card key={email.email_id} variant="outlined">
      <CardContent>
        <Typography sx={{ fontWeight: 700 }}>
          {email.from_name}
        </Typography>

        <Typography variant="body2" sx={{ mb: 2 }}>
          {email.subject}
        </Typography>

        <Button
          variant="outlined"
          color="warning"
          onClick={() => setSelectedEmail(email)}
        >
          Prepare Reply
        </Button>
      </CardContent>
    </Card>
  ))}
</Stack>
            {selectedEmail && (
  <Card sx={{ mb: 3, borderRadius: 3 }}>
    <CardContent>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
        ✨ Suggested Vendor Reply
      </Typography>

      <Typography variant="body2" sx={{ mb: 2 }}>
        To: {selectedEmail.from_address}
      </Typography>

      <TextField
        label="Email Draft"
        multiline
        minRows={6}
        fullWidth
        key={selectedEmail.email_id}
        defaultValue={`Hello ${selectedEmail.from_name},

Thank you for your email regarding "${selectedEmail.subject}".

Unfortunately, we could not find an invoice attachment in your message.

Could you please resend the invoice as a PDF?

Thank you,
Accounts Payable Team
Harborline Logistics Inc.`}
      />

      <Button
  variant="contained"
  sx={{ mt: 2, ml: 2 }}
  onClick={() => {
    const draft = document.querySelector(
      'textarea[aria-label="Email Draft"]'
    ) as HTMLTextAreaElement | null

    if (draft) {
      navigator.clipboard.writeText(draft.value)
      alert('Draft copied to clipboard!')
    }
  }}
>
  Copy Draft
</Button>
    </CardContent>
  </Card>
)}
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
  Detected Invoice Emails
</Typography>

<Stack spacing={2} sx={{ mb: 3 }}>
  {invoiceEmails.map((email) => (
    <Card key={email.email_id} variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Box>
            <Typography sx={{ fontWeight: 700 }}>
              {email.from_name}
            </Typography>

            <Typography variant="body2" color="text.secondary">
              {email.subject}
            </Typography>

            <Typography variant="caption" color="text.secondary">
              {email.attachments.join(', ')}
            </Typography>
          </Box>

          <Chip label="Invoice Detected" color="success" size="small" />
        </Stack>
      </CardContent>
    </Card>
  ))}
</Stack>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <AttachFileIcon color="action" />
              <Typography color="text.secondary">
                Invoice attachments will appear here.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Box>
  )
}