import { useRef, useState } from 'react'
import {
  Box,
  Button,
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

type Props = {
  open: boolean
  onClose: () => void
}

export default function InvoiceUpload({ open, onClose }: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File | undefined) => {
    if (!file) return

    const allowedTypes = [
      'application/pdf',
      'image/png',
      'image/jpeg',
    ]

    if (!allowedTypes.includes(file.type)) {
      alert('Please upload a PDF, PNG, or JPG file.')
      return
    }

    setSelectedFile(file)
  }

  const handleClose = () => {
    setSelectedFile(null)
    onClose()
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
          sx={{ mb: 3 }}
        >
          Upload an invoice to begin the accounts payable review process.
        </Typography>

        <Box
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setIsDragging(false)
            handleFile(event.dataTransfer.files[0])
          }}
          onClick={() => fileInputRef.current?.click()}
          sx={{
            border: `2px dashed ${
              isDragging ? '#404D73' : '#B7C0D4'
            }`,
            borderRadius: 3,
            p: 5,
            textAlign: 'center',
            cursor: 'pointer',
            backgroundColor: isDragging ? '#EEF1F7' : '#F8F9FC',
            transition: '0.2s',
            '&:hover': {
              backgroundColor: '#EEF1F7',
              borderColor: '#59678F',
            },
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            hidden
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
            PDF, PNG, JPG
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
              sx={{ minWidth: 0, color: '#667085' }}
            >
              <CloseIcon fontSize="small" />
            </Button>
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 3 }}>
        <Button onClick={handleClose} sx={{ color: '#59678F' }}>
          Cancel
        </Button>

        <Button
          variant="contained"
          disabled={!selectedFile}
          onClick={() => {
            // Backend integration comes next.
            // Do not mark this invoice as uploaded yet.
            alert('File selected. Backend upload is not connected yet.')
          }}
          sx={{
            backgroundColor: '#404D73',
            '&:hover': {
              backgroundColor: '#354263',
            },
          }}
        >
          Upload Invoice
        </Button>
      </DialogActions>
    </Dialog>
  )
}