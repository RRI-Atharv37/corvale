import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const rebuildLocalDbMock = vi.fn()
const provisionLocalDbMock = vi.fn()
const purgeLocalPinKeysMock = vi.fn()
const hasAnyPinMaterialMock = vi.fn()
const toastSuccessMock = vi.fn()

vi.mock('../bootstrapLocalDb', () => ({ rebuildLocalDb: (...a: unknown[]) => rebuildLocalDbMock(...a) }))
vi.mock('../provisionLocalDb', () => ({ provisionLocalDb: (...a: unknown[]) => provisionLocalDbMock(...a) }))
vi.mock('../../offline/pinStorage', () => ({
  hasAnyPinMaterial: (...a: unknown[]) => hasAnyPinMaterialMock(...a),
  purgeLocalPinKeys: (...a: unknown[]) => purgeLocalPinKeysMock(...a),
}))
vi.mock('react-hot-toast', () => ({ default: { success: (...a: unknown[]) => toastSuccessMock(...a) } }))
vi.mock('../../hooks/useUser', () => ({ useUser: () => ({ user: { _id: 'user-1' } }) }))

const { default: LocalDbRecoveryGate } = await import('../LocalDbRecoveryGate')
const { markLocalDbDamaged, resetLocalDbHealthForTests, getLocalDbHealth } = await import('../localDbHealth')

describe('LocalDbRecoveryGate (BUG-30)', () => {
  beforeEach(() => {
    resetLocalDbHealthForTests()
    rebuildLocalDbMock.mockReset().mockResolvedValue(undefined)
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
