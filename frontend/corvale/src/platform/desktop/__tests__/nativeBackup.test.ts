import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

const { openBackupFileNative, saveFileNative } = await import('../nativeBackup')

const b64 = (s: string) => btoa(s)

describe('nativeBackup', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('base64-encodes a string body and invokes save_file', async () => {
    invokeMock.mockResolvedValueOnce(true)

    const result = await saveFileNative('corvale-report-2026-01.csv', 'date,amount\n2026-01-01,10')

    expect(invokeMock).toHaveBeenCalledWith('save_file', {
      filename: 'corvale-report-2026-01.csv',
      contentsBase64: b64('date,amount\n2026-01-01,10'),
    })
    expect(result).toBe(true)
  })

  it('reads a Blob body into bytes before encoding', async () => {
    invokeMock.mockResolvedValueOnce(true)

    await saveFileNative('backup.json', new Blob(['{"a":1}'], { type: 'application/json' }))

    expect(invokeMock).toHaveBeenCalledWith('save_file', {
      filename: 'backup.json',
      contentsBase64: b64('{"a":1}'),
    })
  })

  it('accepts raw bytes', async () => {
    invokeMock.mockResolvedValueOnce(true)

    await saveFileNative('backup.zip', new Uint8Array([1, 2, 3]))

    expect(invokeMock).toHaveBeenCalledWith('save_file', {
      filename: 'backup.zip',
      contentsBase64: btoa(String.fromCharCode(1, 2, 3)),
    })
  })

  it('returns false (not a rejection) when the save dialog is cancelled', async () => {
    invokeMock.mockResolvedValueOnce(false)

    const result = await saveFileNative('backup.json', '{}')

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
