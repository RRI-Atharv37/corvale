import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalDb } from '../LocalDb'

vi.mock('../../utils/localFirstFlag', () => ({ isLocalFirstEnabled: vi.fn() }))
vi.mock('../../desktop/isTauri', () => ({ isTauriRuntime: vi.fn() }))

const tauriCreate = vi.fn()
vi.mock('../TauriSqlDriver', () => ({
  TauriSqlDriver: { create: (...args: unknown[]) => tauriCreate(...args) },
}))

const wasmCreate = vi.fn()
vi.mock('../SqliteWasmDriver', () => ({
  SqliteWasmDriver: { create: (...args: unknown[]) => wasmCreate(...args) },
}))

const { isLocalFirstEnabled } = await import('../../utils/localFirstFlag')
const { isTauriRuntime } = await import('../../desktop/isTauri')
const { bootstrapLocalDb } = await import('../bootstrapLocalDb')
const { getLocalDb, resetLocalDbForTests } = await import('../localDbInstance')

const fakeDb = (): LocalDb => ({
  exec: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue([]),
  transaction: vi.fn(async (fn) => fn({ exec: vi.fn(), select: vi.fn(), transaction: vi.fn(), close: vi.fn() })),
  close: vi.fn(),
})

describe('bootstrapLocalDb', () => {
  beforeEach(() => {
    resetLocalDbForTests()
    tauriCreate.mockReset()
    wasmCreate.mockReset()
    vi.mocked(isLocalFirstEnabled).mockReset()
    vi.mocked(isTauriRuntime).mockReset()
  })

  it('does nothing when local-first is disabled, leaving the lazy default driver in place', async () => {
    vi.mocked(isLocalFirstEnabled).mockReturnValue(false)

    await bootstrapLocalDb()

    expect(tauriCreate).not.toHaveBeenCalled()
    expect(wasmCreate).not.toHaveBeenCalled()
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

  it('swallows driver creation errors instead of throwing out of app boot', async () => {
    vi.mocked(isLocalFirstEnabled).mockReturnValue(true)
    vi.mocked(isTauriRuntime).mockReturnValue(true)
    tauriCreate.mockRejectedValue(new Error('native module unavailable'))

    await expect(bootstrapLocalDb()).resolves.toBeUndefined()
  })
})
