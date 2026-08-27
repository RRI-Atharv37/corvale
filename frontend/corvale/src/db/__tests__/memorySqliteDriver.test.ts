import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '../MemorySqliteDriver'
import type { LocalDb } from '../LocalDb'

describe('MemorySqliteDriver', () => {
  let db: LocalDb

  beforeEach(async () => {
    db = await MemorySqliteDriver.create()
    await db.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, balance REAL NOT NULL)')
  })

  afterEach(async () => {
    await db.close()
  })

  it('round-trips a create/insert/select', async () => {
    await db.exec('INSERT INTO accounts (name, balance) VALUES (?, ?)', ['Checking', 100.5])
    await db.exec('INSERT INTO accounts (name, balance) VALUES (?, ?)', ['Savings', 250])

    const rows = await db.select<{ id: number; name: string; balance: number }>(
      'SELECT id, name, balance FROM accounts ORDER BY name'
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'Checking', balance: 100.5 })
    expect(rows[1]).toMatchObject({ name: 'Savings', balance: 250 })
  })

  it('returns an empty array when a select matches nothing', async () => {
    const rows = await db.select('SELECT * FROM accounts WHERE name = ?', ['Nonexistent'])
    expect(rows).toEqual([])
  })

  it('commits all writes made inside a successful transaction', async () => {
    await db.transaction(async (tx) => {
      await tx.exec('INSERT INTO accounts (name, balance) VALUES (?, ?)', ['Checking', 100])
      await tx.exec('INSERT INTO accounts (name, balance) VALUES (?, ?)', ['Savings', 200])
    })

    const rows = await db.select('SELECT * FROM accounts')
    expect(rows).toHaveLength(2)
  })

  it('rolls back every write inside a transaction that throws, leaving nothing partially committed', async () => {
    await db.exec('INSERT INTO accounts (name, balance) VALUES (?, ?)', ['Preexisting', 5])

    await expect(
      db.transaction(async (tx) => {
        await tx.exec('INSERT INTO accounts (name, balance) VALUES (?, ?)', ['Checking', 100])
        await tx.exec('INSERT INTO accounts (name, balance) VALUES (?, ?)', ['Savings', 200])
        throw new Error('simulated failure mid-transaction')
      })
    ).rejects.toThrow('simulated failure mid-transaction')

    const rows = await db.select('SELECT * FROM accounts')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Preexisting' })
  })

  it('rolls back on a thrown error from a failing SQL statement inside a transaction', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec('INSERT INTO accounts (name, balance) VALUES (?, ?)', ['Checking', 100])
        await tx.exec('INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)', [1, 'Duplicate id', 1])
        await tx.exec('INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)', [1, 'Duplicate id again', 1])
      })
    ).rejects.toBeTruthy()

    const rows = await db.select('SELECT * FROM accounts')
    expect(rows).toHaveLength(0)
  })

  it('rejects the promise instead of failing silently on invalid SQL', async () => {
    await expect(db.exec('NOT VALID SQL AT ALL')).rejects.toThrow()
  })

  it('rejects the promise on a select against a nonexistent table', async () => {
    await expect(db.select('SELECT * FROM does_not_exist')).rejects.toThrow(/no such table/i)
  })

  it('surfaces a constraint violation as a rejected promise', async () => {
    await db.exec('INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)', [1, 'First', 10])
    await expect(
      db.exec('INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)', [1, 'Second', 20])
    ).rejects.toThrow()

    const rows = await db.select('SELECT * FROM accounts')
    expect(rows).toHaveLength(1)
  })
})
