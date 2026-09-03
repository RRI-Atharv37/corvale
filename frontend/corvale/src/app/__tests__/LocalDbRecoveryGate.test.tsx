import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const rebuildLocalDbMock = vi.fn()
const retryLocalDbOpenMock = vi.fn()
const provisionLocalDbMock = vi.fn()
const purgeLocalPinKeysMock = vi.fn()
const hasAnyPinMaterialMock = vi.fn()
const toastSuccessMock = vi.fn()

vi.mock('@platform/db/bootstrapLocalDb', () => ({
  rebuildLocalDb: (...a: unknown[]) => rebuildLocalDbMock(...a),
  retryLocalDbOpen: (...a: unknown[]) => retryLocalDbOpenMock(...a),
}))
vi.mock('@platform/db/provisionLocalDb', () => ({ provisionLocalDb: (...a: unknown[]) => provisionLocalDbMock(...a) }))
vi.mock('@platform/offline/pinStorage', () => ({
  hasAnyPinMaterial: (...a: unknown[]) => hasAnyPinMaterialMock(...a),
  purgeLocalPinKeys: (...a: unknown[]) => purgeLocalPinKeysMock(...a),
}))
vi.mock('react-hot-toast', () => ({ default: { success: (...a: unknown[]) => toastSuccessMock(...a) } }))
vi.mock('@/app/providers/useUser', () => ({ useUser: () => ({ user: { _id: 'user-1' } }) }))

const { default: LocalDbRecoveryGate } = await import('../LocalDbRecoveryGate')
const { markLocalDbDamaged, resetLocalDbHealthForTests, getLocalDbHealth } = await import('@platform/db/localDbHealth')

describe('LocalDbRecoveryGate (BUG-30)', () => {
  beforeEach(() => {
    resetLocalDbHealthForTests()
    rebuildLocalDbMock.mockReset().mockResolvedValue(undefined)
    retryLocalDbOpenMock.mockReset().mockResolvedValue(undefined)
    provisionLocalDbMock.mockReset().mockResolvedValue(undefined)
    purgeLocalPinKeysMock.mockReset()
    hasAnyPinMaterialMock.mockReset().mockReturnValue(false)
    toastSuccessMock.mockReset()
  })

  afterEach(() => {
    resetLocalDbHealthForTests()
  })

  it('renders children when the local store is healthy', () => {
    render(
      <LocalDbRecoveryGate>
        <div>dashboard</div>
      </LocalDbRecoveryGate>
    )
    expect(screen.getByText('dashboard')).toBeInTheDocument()
  })

  it('blocks the dashboard with a rebuild prompt when the store is damaged', () => {
    markLocalDbDamaged('file is not a database')
    render(
      <LocalDbRecoveryGate>
        <div>dashboard</div>
      </LocalDbRecoveryGate>
    )
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rebuild local data' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rebuild now' })).toBeInTheDocument()
  })

  it('rebuilds, re-seeds, and reveals the dashboard on success', async () => {
    markLocalDbDamaged('boom')
    render(
      <LocalDbRecoveryGate>
        <div>dashboard</div>
      </LocalDbRecoveryGate>
    )

    await userEvent.click(screen.getByRole('button', { name: 'Rebuild now' }))

    await waitFor(() => expect(screen.getByText('dashboard')).toBeInTheDocument())
    expect(rebuildLocalDbMock).toHaveBeenCalledTimes(1)
    expect(provisionLocalDbMock).toHaveBeenCalledTimes(1)
    // SEC-38: the rebuilt store is re-seeded and stamped with the signed-in user's id.
    expect(provisionLocalDbMock).toHaveBeenCalledWith('user-1')
    expect(getLocalDbHealth()).toBe('ok')
    expect(toastSuccessMock).toHaveBeenCalledWith('Local data rebuilt from your account.')
  })

  it('purges an orphaned PIN and mentions it in the toast', async () => {
    hasAnyPinMaterialMock.mockReturnValue(true)
    markLocalDbDamaged('boom')
    render(
      <LocalDbRecoveryGate>
        <div>dashboard</div>
      </LocalDbRecoveryGate>
    )

    await userEvent.click(screen.getByRole('button', { name: 'Rebuild now' }))

    await waitFor(() => expect(purgeLocalPinKeysMock).toHaveBeenCalledTimes(1))
    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Local data rebuilt from your account. The local PIN on this device was also removed.'
    )
  })

  it('offers a non-destructive retry (not a rebuild) when the key store is unavailable (SEC-40)', async () => {
    markLocalDbDamaged('KEYCHAIN_UNAVAILABLE: the login keyring is locked')
    render(
      <LocalDbRecoveryGate>
        <div>dashboard</div>
      </LocalDbRecoveryGate>
    )

    expect(screen.getByRole('heading', { name: 'Unlock local data' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByText('dashboard')).toBeInTheDocument())
    expect(retryLocalDbOpenMock).toHaveBeenCalledTimes(1)
    expect(rebuildLocalDbMock).not.toHaveBeenCalled()
    expect(provisionLocalDbMock).not.toHaveBeenCalled()
    expect(getLocalDbHealth()).toBe('ok')
  })

  it('shows a keychain-specific error when the retry also fails', async () => {
    retryLocalDbOpenMock.mockRejectedValue(new Error('still locked'))
    markLocalDbDamaged('KEYCHAIN_UNAVAILABLE: locked')
    render(
      <LocalDbRecoveryGate>
        <div>dashboard</div>
      </LocalDbRecoveryGate>
    )

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByText(/system keyring is unlocked/i)).toBeInTheDocument())
    expect(rebuildLocalDbMock).not.toHaveBeenCalled()
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument()
  })

  it('shows an error with a retry when the rebuild fails', async () => {
    rebuildLocalDbMock.mockRejectedValue(new Error('disk failure'))
    markLocalDbDamaged('boom')
    render(
      <LocalDbRecoveryGate>
        <div>dashboard</div>
      </LocalDbRecoveryGate>
    )

    await userEvent.click(screen.getByRole('button', { name: 'Rebuild now' }))

    await waitFor(() => expect(screen.getByText(/rebuild didn.t finish/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument()
  })
})
