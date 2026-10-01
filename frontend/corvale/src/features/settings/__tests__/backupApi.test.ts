import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMock = vi.fn()
const saveExportedFileMock = vi.fn()

vi.mock('@lib/axiosInstance', () => ({ default: { get: (...a: unknown[]) => getMock(...a) } }))
vi.mock('@platform/desktop/downloadExport', async () => {
  const actual = await vi.importActual<typeof import('@platform/desktop/downloadExport')>('@platform/desktop/downloadExport')
  return { ...actual, saveExportedFile: (...a: unknown[]) => saveExportedFileMock(...a) }
})

const { exportBackup, fetchBackupExtras } = await import('../backupApi')

describe('exportBackup (BUG-26: desktop-aware save)', () => {
  beforeEach(() => {
    getMock.mockReset()
    saveExportedFileMock.mockReset()
  })

  it('names a JSON export .json and routes the blob through saveExportedFile', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' })
    getMock.mockResolvedValueOnce(blob)

    await exportBackup('json')

    expect(saveExportedFileMock).toHaveBeenCalledWith(blob, 'corvale-backup.json')
  })

  it('names a ZIP export .zip and forwards the workspace scope as a param', async () => {
    const blob = new Blob(['zip'], { type: 'application/zip' })
    getMock.mockResolvedValueOnce(blob)

    await exportBackup('zip', 'ws-1')

    expect(getMock.mock.calls[0][1]).toMatchObject({ params: { format: 'zip', workspaceId: 'ws-1' } })
    expect(saveExportedFileMock).toHaveBeenCalledWith(blob, 'corvale-backup.zip')
  })
})

describe('fetchBackupExtras (SEC-93: desktop export)', () => {
  beforeEach(() => getMock.mockReset())

  it('reads the account-level sections for the personal scope', async () => {
    const extras = { reconciliationSessions: [], profile: { email: 'a@example.com' } }
    getMock.mockResolvedValueOnce({ success: true, data: extras })

    await expect(fetchBackupExtras(null)).resolves.toEqual(extras)
    expect(getMock.mock.calls[0][0]).toBe('/backup/extras')
    expect(getMock.mock.calls[0][1]?.params ?? {}).not.toHaveProperty('workspaceId')
  })

  it('forwards the workspace scope', async () => {
    getMock.mockResolvedValueOnce({ success: true, data: {} })

    await fetchBackupExtras('ws-1')

    expect(getMock.mock.calls[0][1]).toMatchObject({ params: { workspaceId: 'ws-1' } })
  })

  it('lets a network failure propagate so the export can report what it left out', async () => {
    getMock.mockRejectedValueOnce(new Error('Network Error'))

    await expect(fetchBackupExtras(null)).rejects.toThrow('Network Error')
  })
})
