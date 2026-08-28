import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

const { TauriSqlDriver } = await import('../TauriSqlDriver')

describe('TauriSqlDriver', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
  })

  it('opens the database via db_open with the given filename', async () => {
    await TauriSqlDriver.create('custom.sqlite3')
    expect(invokeMock).toHaveBeenCalledWith('db_open', { filename: 'custom.sqlite3' })
  })

  it('defaults the filename to corvale.sqlite3', async () => {
    await TauriSqlDriver.create()
    expect(invokeMock).toHaveBeenCalledWith('db_open', { filename: 'corvale.sqlite3' })
  })

  it('forwards exec calls with sql and params', async () => {
    const db = await TauriSqlDriver.create()
    invokeMock.mockClear()

    await db.exec('INSERT INTO accounts (name) VALUES (?)', ['Checking'])

    expect(invokeMock).toHaveBeenCalledWith('db_exec', {
      sql: 'INSERT INTO accounts (name) VALUES (?)',
      params: ['Checking'],
    })
  })

  it('defaults exec params to an empty array', async () => {
    const db = await TauriSqlDriver.create()
    invokeMock.mockClear()

    await db.exec('DELETE FROM accounts')

    expect(invokeMock).toHaveBeenCalledWith('db_exec', { sql: 'DELETE FROM accounts', params: [] })
  })

  it('forwards select calls and returns the rows verbatim', async () => {
    const rows = [{ id: 1, name: 'Checking' }]
    const db = await TauriSqlDriver.create()
    invokeMock.mockClear()
    invokeMock.mockResolvedValueOnce(rows)

    const result = await db.select('SELECT * FROM accounts')

    expect(invokeMock).toHaveBeenCalledWith('db_select', { sql: 'SELECT * FROM accounts', params: [] })
    expect(result).toEqual(rows)
  })

  it('wraps a successful transaction in BEGIN/COMMIT exec calls, in order', async () => {
    const db = await TauriSqlDriver.create()
    invokeMock.mockClear()

    const result = await db.transaction(async (tx) => {
      await tx.exec('INSERT INTO accounts (name) VALUES (?)', ['Checking'])
      return 'ok'
    })

    expect(result).toBe('ok')
    expect(invokeMock.mock.calls.map((call) => call[0])).toEqual(['db_exec', 'db_exec', 'db_exec'])
    expect(invokeMock.mock.calls[0][1]).toEqual({ sql: 'BEGIN', params: [] })
    expect(invokeMock.mock.calls[1][1]).toMatchObject({ sql: 'INSERT INTO accounts (name) VALUES (?)' })
    expect(invokeMock.mock.calls[2][1]).toEqual({ sql: 'COMMIT', params: [] })
  })

  it('rolls back via exec and rethrows when the transaction callback throws', async () => {
    const db = await TauriSqlDriver.create()
    invokeMock.mockClear()

    await expect(
      db.transaction(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    expect(invokeMock.mock.calls.map((call) => call[0])).toEqual(['db_exec', 'db_exec'])
    expect(invokeMock.mock.calls[0][1]).toEqual({ sql: 'BEGIN', params: [] })
    expect(invokeMock.mock.calls[1][1]).toEqual({ sql: 'ROLLBACK', params: [] })
  })

  it('sends the passphrase and salt (as a plain array) to db_set_key', async () => {
    const db = await TauriSqlDriver.create()
    invokeMock.mockClear()

    await db.setEncryptionKey('1234', new Uint8Array([1, 2, 3]))

    expect(invokeMock).toHaveBeenCalledWith('db_set_key', { passphrase: '1234', salt: [1, 2, 3] })
  })

  it('closes via db_close', async () => {
    const db = await TauriSqlDriver.create()
    invokeMock.mockClear()

    await db.close()

    expect(invokeMock).toHaveBeenCalledWith('db_close')
  })
})
