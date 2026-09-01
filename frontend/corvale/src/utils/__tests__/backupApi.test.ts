import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMock = vi.fn()
const saveExportedFileMock = vi.fn()

vi.mock('../axiosInstance', () => ({ default: { get: (...a: unknown[]) => getMock(...a) } }))
vi.mock('../downloadExport', async () => {
  const actual = await vi.importActual<typeof import('../downloadExport')>('../downloadExport')
  return { ...actual, saveExportedFile: (...a: unknown[]) => saveExportedFileMock(...a) }
})

const { exportBackup } = await import('../backupApi')

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
