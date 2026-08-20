import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

const { openBackupFileNative, saveBackupFileNative } = await import('../nativeBackup')

describe('nativeBackup', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('invokes save_backup_file with filename and contents', async () => {
    invokeMock.mockResolvedValueOnce(true)

    const result = await saveBackupFileNative('spndr-backup.json', '{"a":1}')

    expect(invokeMock).toHaveBeenCalledWith('save_backup_file', {
      filename: 'spndr-backup.json',
      contents: '{"a":1}',
    })
    expect(result).toBe(true)
  })

  it('returns false (not a rejection) when the save dialog is cancelled', async () => {
    invokeMock.mockResolvedValueOnce(false)

    const result = await saveBackupFileNative('spndr-backup.json', '{}')

    expect(result).toBe(false)
  })

  it('invokes open_backup_file and returns its contents', async () => {
    invokeMock.mockResolvedValueOnce('{"a":1}')

    const result = await openBackupFileNative()

    expect(invokeMock).toHaveBeenCalledWith('open_backup_file')
    expect(result).toBe('{"a":1}')
  })

  it('returns null when the open dialog is cancelled', async () => {
    invokeMock.mockResolvedValueOnce(null)

    const result = await openBackupFileNative()

    expect(result).toBeNull()
  })
})
