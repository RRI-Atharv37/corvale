import { describe, expect, it, afterEach } from 'vitest'
import { MemorySqliteDriver } from '@platform/db/MemorySqliteDriver'
import { runMigrations } from '@platform/db/migrations/runMigrations'
import { MIGRATIONS } from '@platform/db/migrations/schema'
import { Repository } from '@platform/db/repositories/Repository'
import type { LocalDb } from '@platform/db/LocalDb'
import type { LocalAccount, LocalCategory, LocalTransaction } from '../types'
import { createLocalTransfer } from '../transfers'

const freshDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const nowIso = () => new Date().toISOString()

const accountsRepo = new Repository<LocalAccount>('accounts')
const categoriesRepo = new Repository<LocalCategory>('categories')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

let idCounter = 0
const nextId = (): string => {
  idCounter += 1
  return `id-${idCounter.toString().padStart(6, '0')}`
}

/** Every transfer files under the shared "Other" master category (userId null, masterCategoryId
 * null, name 'Other') - mirrors `backend/utils/categorySeed.ts`. */
const seedOtherCategory = async (db: LocalDb): Promise<string> => {
  const otherId = nextId()
  await categoriesRepo.upsertFromServer(db, [
    { _id: otherId, updatedAt: nowIso(), userId: null, masterCategoryId: null, name: 'Other', isArchived: false },
  ])
  return otherId
}

describe('domain/transfers: createLocalTransfer', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
  })

  it('moves money between two asset accounts in the correct direction (checking 1000 -> savings 500, transfer 200: checking=800, savings=700)', async () => {
    const db = await freshDb()
    await seedOtherCategory(db)
    const fromId = nextId()
    const toId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: fromId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, openingBalance: 1000, isArchived: false },
      { _id: toId, updatedAt: nowIso(), userId: 'u1', name: 'Savings', type: 'savings', currency: 'USD', currentBalance: 500, openingBalance: 500, isArchived: false },
    ])

    const result = await createLocalTransfer(db, {
      userId: 'u1',
      title: 'Move to savings',
      amount: 200,
      date: '2026-05-01',
      fromAccountId: fromId,
      toAccountId: toId,
    })

    expect(result.outboundId).not.toBe(result.inboundId)

    // Balance persisted by createLocalTransfer itself.
    const fromAccount = await accountsRepo.findById(db, fromId)
    const toAccount = await accountsRepo.findById(db, toId)
    expect(fromAccount?.currentBalance).toBe(800)
    expect(toAccount?.currentBalance).toBe(700)

    const outbound = await transactionsRepo.findById(db, result.outboundId)
    const inbound = await transactionsRepo.findById(db, result.inboundId)
    expect(outbound?.type).toBe('transfer')
    expect(inbound?.type).toBe('transfer')
    expect(outbound?.transferPairId).toBe(result.inboundId)
    expect(inbound?.transferPairId).toBe(result.outboundId)
    expect(outbound?.accountId).toBe(fromId)
    expect(inbound?.accountId).toBe(toId)
    expect(outbound?.amount).toBe(20000)
    expect(inbound?.amount).toBe(20000)
  })

  it('applies the credit-account sign flip correctly (checking 1000 -> credit card owing 300, transfer 100: checking=900, credit owed=200)', async () => {
    // Hand-computed: getTransferOutDeltaMajor(10000, 'checking') = -100 (checking: 1000-100=900).
    // getTransferInDeltaMajor(10000, 'credit') = getBalanceDeltaMajor('income', ..., 'credit') =
    // -100 for a credit account (paying the card down reduces what's owed: 300-100=200).
    const db = await freshDb()
    await seedOtherCategory(db)
    const checkingId = nextId()
    const creditId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: checkingId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
      { _id: creditId, updatedAt: nowIso(), userId: 'u1', name: 'Credit Card', type: 'credit', currency: 'USD', currentBalance: 300, isArchived: false },
    ])

    await createLocalTransfer(db, {
      userId: 'u1',
      title: 'Pay credit card',
      amount: 100,
      date: '2026-05-02',
      fromAccountId: checkingId,
      toAccountId: creditId,
    })

    const checkingAccount = await accountsRepo.findById(db, checkingId)
    const creditAccount = await accountsRepo.findById(db, creditId)
    expect(checkingAccount?.currentBalance).toBe(900)
    expect(creditAccount?.currentBalance).toBe(200)
  })

  it('rejects a transfer between accounts of different currencies', async () => {
    const db = await freshDb()
    await seedOtherCategory(db)
    const fromId = nextId()
    const toId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: fromId, updatedAt: nowIso(), userId: 'u1', name: 'USD Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
      { _id: toId, updatedAt: nowIso(), userId: 'u1', name: 'EUR Savings', type: 'savings', currency: 'EUR', currentBalance: 500, isArchived: false },
    ])

    await expect(
      createLocalTransfer(db, {
        userId: 'u1',
        amount: 50,
        date: '2026-05-01',
        fromAccountId: fromId,
        toAccountId: toId,
      })
    ).rejects.toThrow(/same currency/)
  })

  it('rejects a transfer to the same account', async () => {
    const db = await freshDb()
    await seedOtherCategory(db)
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])

    await expect(
      createLocalTransfer(db, {
        userId: 'u1',
        amount: 50,
        date: '2026-05-01',
        fromAccountId: accountId,
        toAccountId: accountId,
      })
    ).rejects.toThrow(/must be different/)
  })

  it('rejects when the "Other" master category has not synced locally yet', async () => {
    const db = await freshDb()
    const fromId = nextId()
    const toId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: fromId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
      { _id: toId, updatedAt: nowIso(), userId: 'u1', name: 'Savings', type: 'savings', currency: 'USD', currentBalance: 500, isArchived: false },
    ])

    await expect(
      createLocalTransfer(db, { userId: 'u1', amount: 50, date: '2026-05-01', fromAccountId: fromId, toAccountId: toId })
    ).rejects.toThrow(/not synced locally/)
  })

  it('leaves no partial writes when the transaction rolls back (currency mismatch mid-validation)', async () => {
    const db = await freshDb()
    await seedOtherCategory(db)
    const fromId = nextId()
    const toId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: fromId, updatedAt: nowIso(), userId: 'u1', name: 'USD Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
      { _id: toId, updatedAt: nowIso(), userId: 'u1', name: 'EUR Savings', type: 'savings', currency: 'EUR', currentBalance: 500, isArchived: false },
    ])

    await expect(
      createLocalTransfer(db, { userId: 'u1', amount: 50, date: '2026-05-01', fromAccountId: fromId, toAccountId: toId })
    ).rejects.toThrow()

    const allTransactions = await transactionsRepo.list(db)
    expect(allTransactions).toHaveLength(0)
    const fromAccount = await accountsRepo.findById(db, fromId)
    expect(fromAccount?.currentBalance).toBe(1000)
  })

  it('rejects a workspace-scoped transfer while offline, per the outbox workspace-write guard', async () => {
    const db = await freshDb()
    await seedOtherCategory(db)
    const fromId = nextId()
    const toId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: fromId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
      { _id: toId, updatedAt: nowIso(), userId: 'u1', name: 'Savings', type: 'savings', currency: 'USD', currentBalance: 500, isArchived: false },
    ])

    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })

    await expect(
      createLocalTransfer(db, {
        userId: 'u1',
        workspaceId: 'ws-1',
        amount: 50,
        date: '2026-05-01',
        fromAccountId: fromId,
        toAccountId: toId,
      })
    ).rejects.toThrow(/offline/i)

    // Rolled back - neither leg nor balance change should have persisted.
    expect(await transactionsRepo.list(db)).toHaveLength(0)
    const fromAccount = await accountsRepo.findById(db, fromId)
    expect(fromAccount?.currentBalance).toBe(1000)
  })
})
