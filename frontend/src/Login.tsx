// frontend/src/Login.tsx

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'

import { authService, type User } from './api/services'
import { setToken } from './api/client'

interface LoginProps {
  onLogin: (user: User) => void
}

const demoUsers = [
  { id: 'U004', label: 'AP Clerk - Jordan Okafor' },
  { id: 'U007', label: 'Approver - Dev Malhotra' },
  { id: 'U003', label: 'Finance Manager - Elise Tremblay' },
  { id: 'U001', label: 'Controller - Priya Raman' },
  { id: 'U006', label: 'Auditor - Hannah Lindqvist' },
  { id: 'U013', label: 'Employee - Aiden Grant' },
]

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('U004')
  const [password, setPassword] = useState('demo1234')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin() {
    setLoading(true)
    setError('')

    try {
      const result = await authService.login(username, password)

      setToken(result.token)
      onLogin(result.user)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to log in'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F8F9FA',
      }}
    >
      <Card sx={{ width: 420, maxWidth: '90%' }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={3}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography
  variant="h4"
  sx={{
    fontWeight: 700,
    color: '#404D73',
  }}
>
                BLUEBERI
              </Typography>

              <Typography color="text.secondary">
                Invoice Automation
              </Typography>
            </Box>

            <Typography variant="h6">
              Sign in to your account
            </Typography>

            {error && (
              <Alert severity="error">{error}</Alert>
            )}

            <TextField
              select
              fullWidth
              label="Demo User"
              value={username}
              onChange={(event) =>
                setUsername(event.target.value)
              }
            >
              {demoUsers.map((user) => (
                <MenuItem
                  key={user.id}
                  value={user.id}
                >
                  {user.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              fullWidth
              label="Password"
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
            />

            <Button
              variant="contained"
              size="large"
              disabled={loading}
              onClick={handleLogin}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}