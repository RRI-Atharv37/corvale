import { describe, expect, it, afterEach } from 'vitest'
import { MemorySqliteDriver } from '../../db/MemorySqliteDriver'
import { runMigrations } from '../../db/migrations/runMigrations'
import { MIGRATIONS } from '../../db/migrations/schema'
import { Repository } from '../../db/repositories/Repository'
import type { LocalDb } from '../../db/LocalDb'
import type { LocalAccount, LocalTransaction } from '../types'
import { createLocalSplitExpense } from '../splits'

const freshDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const nowIso = () => new Date().toISOString()

const accountsRepo = new Repository<LocalAccount>('accounts')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

let idCounter = 0
const nextId = (): string => {
  idCounter += 1
  return `id-${idCounter.toString().padStart(6, '0')}`
}

describe('domain/splits: createLocalSplitExpense', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
  })

  it('creates a parent + child rows whose amounts sum to the parent, and counts the account balance once (checking 1000 - 150 = 850)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    const foodCategoryId = nextId()
    const transportCategoryId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, openingBalance: 1000, isArchived: false },
    ])

    const result = await createLocalSplitExpense(db, {
      userId: 'u1',
      title: 'Grocery run',
      amount: 150,
      date: '2026-05-01',
      accountId,
      splits: [
        { categoryId: foodCategoryId, amount: 90 },
        { categoryId: transportCategoryId, amount: 60 },
      ],
    })

    expect(result.childIds).toHaveLength(2)

    const parent = await transactionsRepo.findById(db, result.parentId)
    expect(parent).toBeDefined()
    expect(parent?.type).toBe('expense')
    expect(parent?.amount).toBe(15000)
    expect(parent?.splitTransactionId).toBeNull()
    // Parent's own categoryId is the FIRST split line's category, mirroring the server's
    // `resolvedCategoryId = hasSplits ? splits[0].categoryId : categoryId`.
    expect(parent?.categoryId).toBe(foodCategoryId)

    const children = await Promise.all(result.childIds.map((id) => transactionsRepo.findById(db, id)))
    const childAmounts = children.map((child) => child?.amount).sort((a, b) => (a ?? 0) - (b ?? 0))
    expect(childAmounts).toEqual([6000, 9000])
    expect(childAmounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0)).toBe(parent?.amount)
    for (const child of children) {
      expect(child?.splitTransactionId).toBe(result.parentId)
    }

    const account = await accountsRepo.findById(db, accountId)
    expect(account?.currentBalance).toBe(850)
  })

  it('rejects when split amounts do not sum to the total', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])

    await expect(
      createLocalSplitExpense(db, {
        userId: 'u1',
        title: 'Bad split',
        amount: 150,
        date: '2026-05-01',
        accountId,
        splits: [
          { categoryId: 'cat-1', amount: 90 },
          { categoryId: 'cat-2', amount: 50 },
        ],
      })
    ).rejects.toThrow()

    expect(await transactionsRepo.list(db)).toHaveLength(0)
    const account = await accountsRepo.findById(db, accountId)
    expect(account?.currentBalance).toBe(1000)
  })

  it('rejects fewer than 2 split lines', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])

    await expect(
      createLocalSplitExpense(db, {
        userId: 'u1',
        title: 'Single line',
        amount: 90,
        date: '2026-05-01',
        accountId,
        splits: [{ categoryId: 'cat-1', amount: 90 }],
      })
    ).rejects.toThrow()
  })

  it('rejects for an archived account', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: true },
    ])

    await expect(
      createLocalSplitExpense(db, {
        userId: 'u1',
        title: 'Grocery run',
        amount: 150,
        date: '2026-05-01',
        accountId,
        splits: [
          { categoryId: 'cat-1', amount: 90 },
          { categoryId: 'cat-2', amount: 60 },
        ],
      })
    ).rejects.toThrow(/archived/)
  })

  it('rejects a workspace-scoped split create while offline, per the outbox workspace-write guard', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])

    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })

    await expect(
      createLocalSplitExpense(db, {
        userId: 'u1',
        workspaceId: 'ws-1',
        title: 'Grocery run',
        amount: 150,
        date: '2026-05-01',
        accountId,
        splits: [
          { categoryId: 'cat-1', amount: 90 },
          { categoryId: 'cat-2', amount: 60 },
        ],
      })
    ).rejects.toThrow(/offline/i)

    expect(await transactionsRepo.list(db)).toHaveLength(0)
    const account = await accountsRepo.findById(db, accountId)
    expect(account?.currentBalance).toBe(1000)
  })
})
