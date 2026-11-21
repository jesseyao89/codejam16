// frontend/src/api/invoices.ts

const API_BASE_URL = '/api'

export type Invoice = {
  id: string
  vendor: string
  amount: string
  status: string
}

export async function getInvoices(): Promise<Invoice[]> {
  const response = await fetch(`${API_BASE_URL}/invoices/`)

  if (!response.ok) {
    throw new Error(`Failed to load invoices: ${response.status}`)
  }

  return response.json()
}

export async function uploadInvoice(file: File) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_BASE_URL}/invoices/upload/`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Failed to upload invoice: ${response.status}`)
  }

  return response.json()
}