import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiModule from '../../lib/api'
import EnrolPage from '../EnrolPage'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, api: { ...actual.api, enrolStart: vi.fn(), enrolComplete: vi.fn() } }
})

const START = {
  email: 'founder@example.com',
  role: 'owner' as const,
  secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/Corvale%20Admin:founder%40example.com?secret=JBSWY3DPEHPK3PXP',
  requiresPassword: true,
}

const CODES = Array.from({ length: 10 }, (_, i) => `code${i}-abcde`)

const renderEnrol = (hash = '#token=abc-def-ghi-jkl-mno-pqr-stu-vwx') => {
  window.history.replaceState(null, '', `/enrol${hash}`)
  return render(
    <MemoryRouter initialEntries={['/enrol']}>
      <Routes>
        <Route path="/enrol" element={<EnrolPage />} />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.mocked(apiModule.api.enrolStart).mockReset().mockResolvedValue(START)
  vi.mocked(apiModule.api.enrolComplete).mockReset().mockResolvedValue({ recoveryCodes: CODES })
})

describe('EnrolPage', () => {
  it('reads the token from the URL fragment and removes it from the address bar', async () => {
    renderEnrol()

    await screen.findByText('founder@example.com')

    expect(apiModule.api.enrolStart).toHaveBeenCalledWith('abc-def-ghi-jkl-mno-pqr-stu-vwx')
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('')
  })

  it('explains itself when there is no token, and calls nothing', async () => {
    renderEnrol('')

    expect(await screen.findByRole('alert')).toHaveTextContent(/link/i)
    expect(apiModule.api.enrolStart).not.toHaveBeenCalled()
  })

  it('shows a refused or expired link as an error', async () => {
    vi.mocked(apiModule.api.enrolStart).mockRejectedValue(new apiModule.ApiError('This enrolment link is invalid or has expired', 400))
    renderEnrol()

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/i)
  })

  it('shows the authenticator secret in groups for manual entry', async () => {
    renderEnrol()

    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument()
  })

  it('asks a first-time admin to choose a password of at least 14 characters, and does not call the server for a short one', async () => {
    const user = userEvent.setup()
    renderEnrol()

    await user.type(await screen.findByLabelText('New password'), 'too short')
    await user.type(screen.getByLabelText(/authenticator code/i), '123456')
    await user.click(screen.getByRole('button', { name: /finish setup/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 14 characters/i)
    expect(apiModule.api.enrolComplete).not.toHaveBeenCalled()
  })

  it('asks a re-enrolling admin for their existing password instead of a new one', async () => {
    vi.mocked(apiModule.api.enrolStart).mockResolvedValue({ ...START, requiresPassword: false })
    renderEnrol()

    expect(await screen.findByLabelText('Current password')).toBeInTheDocument()
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })

  it('completes, then shows the recovery codes once and only moves on when they are acknowledged', async () => {
    const user = userEvent.setup()
    renderEnrol()

    await user.type(await screen.findByLabelText('New password'), 'a long enough passphrase')
    await user.type(screen.getByLabelText(/authenticator code/i), '123456')
    await user.click(screen.getByRole('button', { name: /finish setup/i }))

    await waitFor(() =>
      expect(apiModule.api.enrolComplete).toHaveBeenCalledWith({
        token: 'abc-def-ghi-jkl-mno-pqr-stu-vwx',
        password: 'a long enough passphrase',
        totpCode: '123456',
      })
    )
    for (const code of CODES) expect(await screen.findByText(code)).toBeInTheDocument()
    expect(screen.queryByText('Login page')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /saved these/i }))
    expect(await screen.findByText('Login page')).toBeInTheDocument()
  })

  it('shows the server error when the code is wrong and stays on the form', async () => {
    vi.mocked(apiModule.api.enrolComplete).mockRejectedValue(new apiModule.ApiError('The authenticator code is not valid', 400))
    const user = userEvent.setup()
    renderEnrol()

    await user.type(await screen.findByLabelText('New password'), 'a long enough passphrase')
    await user.type(screen.getByLabelText(/authenticator code/i), '000000')
    await user.click(screen.getByRole('button', { name: /finish setup/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid/i)
    expect(screen.getByRole('button', { name: /finish setup/i })).toBeEnabled()
  })
})
