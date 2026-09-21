import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiModule from '../../lib/api'
import { AuthProvider } from '../../lib/auth'
import LoginPage from '../LoginPage'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    refreshSession: vi.fn().mockResolvedValue(null),
    api: { ...actual.api, login: vi.fn(), logout: vi.fn().mockResolvedValue(undefined) },
  }
})

const LOGIN_RESULT = {
  accessToken: 't',
  expiresInSeconds: 600,
  sessionExpiresAt: '2030-01-01T00:00:00.000Z',
  stepUpUntil: null,
  admin: { id: '1', email: 'ops@example.com', role: 'owner' as const },
}

const renderLogin = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>Overview page</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  )

const fill = async (user: ReturnType<typeof userEvent.setup>, code = '123456') => {
  await user.type(await screen.findByLabelText('Email'), 'ops@example.com')
  await user.type(screen.getByLabelText('Password'), 'correct horse battery staple')
  await user.type(screen.getByLabelText(/authenticator code/i), code)
}

beforeEach(() => {
  vi.mocked(apiModule.api.login).mockReset()
})

describe('LoginPage', () => {
  it('asks for email, password and an authenticator code, with the right autofill hints', async () => {
    renderLogin()

    expect(await screen.findByLabelText('Email')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByLabelText(/authenticator code/i)).toHaveAttribute('autocomplete', 'one-time-code')
    expect(screen.getByLabelText(/authenticator code/i)).toHaveAttribute('inputmode', 'numeric')
  })

  it('signs in and lands on the overview', async () => {
    vi.mocked(apiModule.api.login).mockResolvedValue(LOGIN_RESULT)
    const user = userEvent.setup()
    renderLogin()

    await fill(user)
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Overview page')).toBeInTheDocument()
    expect(apiModule.api.login).toHaveBeenCalledWith({
      email: 'ops@example.com',
      password: 'correct horse battery staple',
      totpCode: '123456',
    })
  })

  it('switches to a recovery code and sends that instead of a TOTP code', async () => {
    vi.mocked(apiModule.api.login).mockResolvedValue(LOGIN_RESULT)
    const user = userEvent.setup()
    renderLogin()

    await user.click(await screen.findByRole('button', { name: /recovery code instead/i }))
    expect(screen.queryByLabelText(/authenticator code/i)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Email'), 'ops@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple')
    await user.type(screen.getByLabelText('Recovery code'), 'abcde-fghij')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() =>
      expect(apiModule.api.login).toHaveBeenCalledWith({
        email: 'ops@example.com',
        password: 'correct horse battery staple',
        recoveryCode: 'abcde-fghij',
      })
    )
  })

  it('shows the server message and keeps the form on a refused login, without saying which part was wrong', async () => {
    vi.mocked(apiModule.api.login).mockRejectedValue(new apiModule.ApiError('Invalid credentials', 401))
    const user = userEvent.setup()
    renderLogin()

    await fill(user)
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials')
    expect(screen.getByLabelText('Email')).toHaveValue('ops@example.com')
    expect(screen.getByLabelText(/authenticator code/i)).toHaveValue('')
  })

  it('shows a lockout message', async () => {
    vi.mocked(apiModule.api.login).mockRejectedValue(new apiModule.ApiError('Too many failed attempts. Try again later', 429))
    const user = userEvent.setup()
    renderLogin()

    await fill(user)
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many failed attempts/i)
  })

  it('disables the button while the request is in flight so a code is not spent twice', async () => {
    let finish: (value: typeof LOGIN_RESULT) => void = () => undefined
    vi.mocked(apiModule.api.login).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const user = userEvent.setup()
    renderLogin()

    await fill(user)
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()
    finish(LOGIN_RESULT)
    expect(await screen.findByText('Overview page')).toBeInTheDocument()
    expect(apiModule.api.login).toHaveBeenCalledTimes(1)
  })

  it('does not let an empty form through', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(await screen.findByRole('button', { name: /sign in/i }))

    expect(apiModule.api.login).not.toHaveBeenCalled()
  })
})
