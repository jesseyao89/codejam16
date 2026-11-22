import { useRef, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'

import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import CloseIcon from '@mui/icons-material/Close'

import {
  invoiceService,
  type Invoice,
} from './api/services'

import { describeError, type ErrorPresentation } from './api/errors'

type Props = {
  open: boolean
  onClose: () => void
  onUploaded: (invoice: Invoice) => void
}

const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg']

export default function InvoiceUpload({
  open,
  onClose,
  onUploaded,
}: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<ErrorPresentation | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File | undefined) => {
    if (!file || uploading) return

    const extensionOk = /\.(pdf|png|jpe?g)$/i.test(file.name)

    if (!ALLOWED_TYPES.includes(file.type) && !extensionOk) {
      setError({
        code: 'VALIDATION_ERROR',
        message: 'Upload a PDF, PNG or JPEG file.',
        hint: 'Scanned PDFs and phone photos are supported.',
      })
      return
    }

    setError(null)
    setSelectedFile(file)
  }

  const handleClose = () => {
    if (uploading) return

    setSelectedFile(null)
    setError(null)
    setIsDragging(false)
    onClose()
  }

  async function handleUpload() {
    if (!selectedFile || uploading) return

    setUploading(true)
    setError(null)

    try {
      const invoice = await invoiceService.upload(selectedFile)

      setSelectedFile(null)
      onUploaded(invoice)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ fontWeight: 700, color: '#263451' }}>
        Upload Invoice
      </DialogTitle>

      <DialogContent>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 2 }}
        >
          Upload an invoice to begin the accounts payable review process.
          Scanned documents and French invoices are supported. If extraction
          cannot read the file, a reviewable blocked draft is created instead
          of guessing fields.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {error.code}
            </Typography>

            <Typography variant="body2">{error.message}</Typography>

            {error.hint && (
              <Typography variant="caption">{error.hint}</Typography>
            )}
          </Alert>
        )}

        <Box
          onDragOver={(event) => {
            event.preventDefault()
            if (!uploading) setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setIsDragging(false)
            handleFile(event.dataTransfer.files[0])
          }}
          onClick={() => {
            if (!uploading) fileInputRef.current?.click()
          }}
          sx={{
            border: `2px dashed ${
              isDragging ? '#404D73' : '#B7C0D4'
            }`,
            borderRadius: 3,
            p: 5,
            textAlign: 'center',
            cursor: uploading ? 'default' : 'pointer',
            backgroundColor: isDragging ? '#EEF1F7' : '#F8F9FC',
            transition: '0.2s',
            '&:hover': {
              backgroundColor: uploading ? undefined : '#EEF1F7',
              borderColor: uploading ? undefined : '#59678F',
            },
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            hidden
            disabled={uploading}
            onChange={(event) => {
              handleFile(event.target.files?.[0])
              event.target.value = ''
            }}
          />

          <CloudUploadIcon
            sx={{
              fontSize: 48,
              color: '#59678F',
              mb: 2,
            }}
          />

          <Typography sx={{ fontWeight: 700, color: '#263451' }}>
            Drag and drop your invoice here
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 1 }}
          >
            or click to browse files
          </Typography>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 2 }}
          >
            PDF, PNG, JPG · scans and French supported
          </Typography>
        </Box>

        {selectedFile && (
          <Stack
            direction="row"
            spacing={2}
            sx={{
              alignItems: 'center',
              mt: 3,
              p: 2,
              border: '1px solid #E5E7EB',
              borderRadius: 2,
            }}
          >
            <InsertDriveFileIcon sx={{ color: '#59678F' }} />

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {selectedFile.name}
              </Typography>

              <Typography variant="caption" color="text.secondary">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </Typography>
            </Box>

            <Button
              onClick={() => setSelectedFile(null)}
              disabled={uploading}
              sx={{ minWidth: 0, color: '#667085' }}
            >
              <CloseIcon fontSize="small" />
            </Button>
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 3 }}>
        <Button
          onClick={handleClose}
          disabled={uploading}
          sx={{ color: '#59678F' }}
        >
          Cancel
        </Button>

        <Button
          variant="contained"
          disabled={!selectedFile || uploading}
          onClick={() => {
            void handleUpload()
          }}
          startIcon={
            uploading ? (
              <CircularProgress size={16} color="inherit" />
            ) : undefined
          }
          sx={{
            backgroundColor: '#404D73',
            '&:hover': {
              backgroundColor: '#354263',
            },
          }}
        >
          {uploading ? 'Extracting...' : 'Upload Invoice'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
