import { beforeEach, describe, expect, it, vi } from 'vitest'

const listMock = vi.fn()
const saveExportedFileMock = vi.fn()

vi.mock('../../db/localDbInstance', () => ({ getLocalDb: vi.fn(async () => ({})) }))
vi.mock('../../sync/sqliteOutboxStore', () => ({
  createSqliteOutboxStore: () => ({ list: listMock }),
}))
vi.mock('../../utils/downloadExport', async () => {
  const actual = await vi.importActual<typeof import('../../utils/downloadExport')>(
    '../../utils/downloadExport'
  )
  return { ...actual, saveExportedFile: (...args: unknown[]) => saveExportedFileMock(...args) }
})

const { exportUnsyncedOps } = await import('../exportUnsyncedOps')

describe('exportUnsyncedOps (BUG-26: route through the shared save helper)', () => {
  beforeEach(() => {
    listMock.mockReset()
    saveExportedFileMock.mockReset()
  })

  it('returns false and saves nothing when the outbox is empty', async () => {
    listMock.mockResolvedValueOnce([])

    expect(await exportUnsyncedOps()).toBe(false)
    expect(saveExportedFileMock).not.toHaveBeenCalled()
  })

  it('hands a JSON blob and a colon-free filename to saveExportedFile', async () => {
    listMock.mockResolvedValueOnce([{ opId: '1' }])
    saveExportedFileMock.mockResolvedValueOnce(true)

    const result = await exportUnsyncedOps()

    expect(result).toBe(true)
    const [blob, filename] = saveExportedFileMock.mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(filename).toMatch(/^corvale-unsynced-changes-.*\.json$/)
    expect(filename).not.toContain(':')
  })

  it('propagates a cancelled desktop save as false', async () => {
    listMock.mockResolvedValueOnce([{ opId: '1' }])
    saveExportedFileMock.mockResolvedValueOnce(false)

    expect(await exportUnsyncedOps()).toBe(false)
  })

  it('resolves false without throwing when the local DB read fails', async () => {
    listMock.mockRejectedValueOnce(new Error('db unavailable'))

    expect(await exportUnsyncedOps()).toBe(false)
  })
})
