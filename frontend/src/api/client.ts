// frontend/src/api/client.ts

const API_BASE = '/api'

export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    details: Record<string, unknown>
  }
}

export interface PaginatedResponse<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export class ApiError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export function getToken(): string | null {
  return localStorage.getItem('blueberi_token')
}

export function setToken(token: string): void {
  localStorage.setItem('blueberi_token', token)
}

export function clearToken(): void {
  localStorage.removeItem('blueberi_token')
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken()

  const headers = new Headers(options.headers)

  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  })

  if (response.status === 204) {
    return undefined as T
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)

    throw new ApiError(
      body?.error?.message || 'Something went wrong',
      body?.error?.code || 'UNKNOWN_ERROR',
      response.status
    )
  }

  return response.json() as Promise<T>
}

async function requestBlob(endpoint: string): Promise<Blob> {
  const token = getToken()

  const headers = new Headers()

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE}${endpoint}`, { headers })

  if (!response.ok) {
    const body = await response.json().catch(() => null)

    throw new ApiError(
      body?.error?.message || 'Something went wrong',
      body?.error?.code || 'UNKNOWN_ERROR',
      response.status
    )
  }

  return response.blob()
}

export const api = {
  get: <T>(endpoint: string) =>
    request<T>(endpoint),

  post: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'POST',
      body: data === undefined ? undefined : JSON.stringify(data),
    }),

  patch: <T>(endpoint: string, data: unknown) =>
    request<T>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  upload: <T>(endpoint: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    return request<T>(endpoint, {
      method: 'POST',
      body: formData,
    })
  },

  download: (endpoint: string) => requestBlob(endpoint),
}