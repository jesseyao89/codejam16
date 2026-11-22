// frontend/src/api/errors.ts
//
// Turns the API error envelope into something a screen can render:
// `{ error: { code, message, details } }` (contract §1.2).

import { ApiError } from './client'

export interface ErrorPresentation {
  code: string
  message: string
  hint: string | null
}

const HINTS: Record<string, string> = {
  UNAUTHENTICATED:
    'Your session is missing or has expired. Sign in again to continue.',
  PERMISSION_DENIED:
    'Your role cannot perform this action, or separation of duties applies. The server enforces this even when the button is visible.',
  NOT_FOUND:
    'The record does not exist anymore or is not visible to your role.',
  INVALID_STATE_TRANSITION:
    'This action is not allowed from the current state. Refresh to see the latest status, then try again.',
  SELF_APPROVAL_BLOCKED:
    'You cannot decide an invoice you requested. It must be approved by your manager.',
  LIMIT_EXCEEDED:
    'The CAD amount is above your release limit. A Finance Manager (up to CAD 100,000) or a Controller is required.',
  VALIDATION_BLOCKED:
    'An open BLOCK finding prevents this action. Correct the invoice data and re-run analysis; BLOCK findings cannot be overridden.',
  VALIDATION_ERROR:
    'The request was rejected as malformed. Check the values and try again.',
  INTERNAL_ERROR:
    'The server failed unexpectedly. Try again, or contact an administrator.',
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export function describeError(error: unknown): ErrorPresentation {
  if (isApiError(error)) {
    return {
      code: error.code,
      message: error.message,
      hint: HINTS[error.code] ?? null,
    }
  }

  return {
    code: 'UNKNOWN_ERROR',
    message:
      error instanceof Error
        ? error.message
        : 'Something went wrong while talking to the server.',
    hint: null,
  }
}
