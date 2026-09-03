import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalDb } from '../LocalDb'

vi.mock('@lib/localFirstFlag', () => ({ isLocalFirstEnabled: vi.fn() }))
vi.mock('@lib/localPinFlag', () => ({ isLocalPinEnabled: vi.fn() }))
vi.mock('@lib/isTauri', () => ({ isTauriRuntime: vi.fn() }))

const tauriCreate = vi.fn()
vi.mock('../TauriSqlDriver', () => ({
  TauriSqlDriver: { create: (...args: unknown[]) => tauriCreate(...args) },
}))

const wasmCreate = vi.fn()
vi.mock('../SqliteWasmDriver', () => ({
  SqliteWasmDriver: { create: (...args: unknown[]) => wasmCreate(...args) },
}))

const { isLocalFirstEnabled } = await import('@lib/localFirstFlag')
const { isLocalPinEnabled } = await import('@lib/localPinFlag')
const { isTauriRuntime } = await import('@lib/isTauri')
const { bootstrapLocalDb, retryLocalDbOpen } = await import('../bootstrapLocalDb')
const { getLocalDb, resetLocalDbForTests } = await import('../localDbInstance')
const { getLocalDbHealth, getLocalDbDamageReason, resetLocalDbHealthForTests } = await import('../localDbHealth')

const fakeDb = (): LocalDb => ({
  exec: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue([]),
  transaction: vi.fn(async (fn) => fn({ exec: vi.fn(), select: vi.fn(), transaction: vi.fn(), close: vi.fn() })),
  close: vi.fn(),
})

describe('bootstrapLocalDb', () => {
  beforeEach(() => {
    resetLocalDbForTests()
    resetLocalDbHealthForTests()
    tauriCreate.mockReset()
    wasmCreate.mockReset()
    vi.mocked(isLocalFirstEnabled).mockReset()
    vi.mocked(isLocalPinEnabled).mockReset()
    vi.mocked(isTauriRuntime).mockReset()
    localStorage.clear()
  })

  it('does nothing when local-first is disabled, leaving the lazy default driver in place', async () => {
    vi.mocked(isLocalFirstEnabled).mockReturnValue(false)

    await bootstrapLocalDb()

    expect(tauriCreate).not.toHaveBeenCalled()
    expect(wasmCreate).not.toHaveBeenCalled()
  })

  it('purges orphaned PIN keys (both name sets) when local-first is disabled (V6)', async () => {
    vi.mocked(isLocalFirstEnabled).mockReturnValue(false)
    localStorage.setItem('corvale_pin_salt', 'salt')
    localStorage.setItem('corvale_pin_verifier', 'verifier')
    localStorage.setItem('corvale_pin_attempts', '3')
    localStorage.setItem('spndr_pin_salt', 'legacy-salt')
    localStorage.setItem('spndr_pin_verifier', 'legacy-verifier')

    await bootstrapLocalDb()

    for (const key of [
      'corvale_pin_salt',
      'corvale_pin_verifier',
      'corvale_pin_attempts',
      'spndr_pin_salt',
      'spndr_pin_verifier',
    ]) {
      expect(localStorage.getItem(key)).toBeNull()
    }
  })

  it('purges an orphaned PIN when local-first is on but the PIN feature is dormant (BUG-31)', async () => {
    vi.mocked(isLocalFirstEnabled).mockReturnValue(true)
    vi.mocked(isLocalPinEnabled).mockReturnValue(false)
    vi.mocked(isTauriRuntime).mockReturnValue(false)
    wasmCreate.mockResolvedValue(fakeDb())
    localStorage.setItem('corvale_pin_salt', 'salt')
    localStorage.setItem('corvale_pin_verifier', 'verifier')
    localStorage.setItem('spndr_pin_verifier', 'legacy-verifier')

    await bootstrapLocalDb()

    expect(localStorage.getItem('corvale_pin_verifier')).toBeNull()
    expect(localStorage.getItem('corvale_pin_salt')).toBeNull()
    expect(localStorage.getItem('spndr_pin_verifier')).toBeNull()
  })

  it('does NOT purge a configured PIN when local-first AND the PIN feature are both on', async () => {
    vi.mocked(isLocalFirstEnabled).mockReturnValue(true)
    vi.mocked(isLocalPinEnabled).mockReturnValue(true)
    vi.mocked(isTauriRuntime).mockReturnValue(false)
    wasmCreate.mockResolvedValue(fakeDb())
    localStorage.setItem('corvale_pin_verifier', 'verifier')

    await bootstrapLocalDb()

    expect(localStorage.getItem('corvale_pin_verifier')).toBe('verifier')
  })

  it('copies pre-rename PIN keys forward when the PIN feature is on', async () => {
    vi.mocked(isLocalFirstEnabled).mockReturnValue(true)
    vi.mocked(isLocalPinEnabled).mockReturnValue(true)
    vi.mocked(isTauriRuntime).mockReturnValue(false)
    wasmCreate.mockResolvedValue(fakeDb())
    localStorage.setItem('spndr_pin_salt', 'legacy-salt')
    localStorage.setItem('spndr_pin_verifier', 'legacy-verifier')

    await bootstrapLocalDb()

    expect(localStorage.getItem('corvale_pin_verifier')).toBe('legacy-verifier')
    expect(localStorage.getItem('spndr_pin_verifier')).toBeNull()
  })

  it('creates and installs a TauriSqlDriver under the Tauri runtime', async () => {
    vi.mocked(isLocalFirstEnabled).mockReturnValue(true)
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    const db = fakeDb()
    tauriCreate.mockResolvedValue(db)

    await bootstrapLocalDb()

    expect(tauriCreate).toHaveBeenCalledTimes(1)
    expect(wasmCreate).not.toHaveBeenCalled()
    await expect(getLocalDb()).resolves.toBe(db)
  })

  it('creates and installs a SqliteWasmDriver in the browser', async () => {
    vi.mocked(isLocalFirstEnabled).mockReturnValue(true)
    vi.mocked(isTauriRuntime).mockReturnValue(false)
    const db = fakeDb()
    wasmCreate.mockResolvedValue(db)

    await bootstrapLocalDb()

    expect(wasmCreate).toHaveBeenCalledTimes(1)
    expect(tauriCreate).not.toHaveBeenCalled()
    await expect(getLocalDb()).resolves.toBe(db)
  })

  it('does not throw out of app boot on a driver open failure, but marks the store damaged (BUG-30)', async () => {
    vi.mocked(isLocalFirstEnabled).mockReturnValue(true)
    vi.mocked(isLocalPinEnabled).mockReturnValue(false)
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    tauriCreate.mockRejectedValue(new Error('native module unavailable'))

    await expect(bootstrapLocalDb()).resolves.toBeUndefined()
    expect(getLocalDbHealth()).toBe('damaged')
  })

  it('marks the store damaged when the post-migration read probe fails (half-encrypted file)', async () => {
    vi.mocked(isLocalFirstEnabled).mockReturnValue(true)
    vi.mocked(isLocalPinEnabled).mockReturnValue(false)
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    const db = fakeDb()
    vi.mocked(db.select).mockRejectedValue(new Error('file is not a database'))
    tauriCreate.mockResolvedValue(db)

    await bootstrapLocalDb()

    expect(getLocalDbHealth()).toBe('damaged')
  })

  it('preserves the KEYCHAIN_UNAVAILABLE tag in the damage reason (SEC-40)', async () => {
    vi.mocked(isLocalFirstEnabled).mockReturnValue(true)
    vi.mocked(isLocalPinEnabled).mockReturnValue(false)
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    tauriCreate.mockRejectedValue('KEYCHAIN_UNAVAILABLE: the login keyring is locked')

    await bootstrapLocalDb()

    expect(getLocalDbHealth()).toBe('damaged')
    expect(getLocalDbDamageReason()).toContain('KEYCHAIN_UNAVAILABLE')
  })

  it('retryLocalDbOpen re-opens and installs the driver without deleting the store', async () => {
    vi.mocked(isLocalFirstEnabled).mockReturnValue(true)
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    const db = fakeDb()
    tauriCreate.mockResolvedValue(db)

    await retryLocalDbOpen()

    expect(tauriCreate).toHaveBeenCalledTimes(1)
    await expect(getLocalDb()).resolves.toBe(db)
  })

  it('leaves the store healthy on a clean open', async () => {
    vi.mocked(isLocalFirstEnabled).mockReturnValue(true)
    vi.mocked(isLocalPinEnabled).mockReturnValue(false)
    vi.mocked(isTauriRuntime).mockReturnValue(false)
    wasmCreate.mockResolvedValue(fakeDb())

    await bootstrapLocalDb()

    expect(getLocalDbHealth()).toBe('ok')
  })
})
