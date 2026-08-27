import { describe, expect, it, afterEach } from 'vitest'
import { MemorySqliteDriver } from '../../db/MemorySqliteDriver'
import { runMigrations } from '../../db/migrations/runMigrations'
import { MIGRATIONS } from '../../db/migrations/schema'
import { Repository } from '../../db/repositories/Repository'
import type { LocalDb } from '../../db/LocalDb'
import type {
  LocalAccount,
  LocalBudget,
  LocalCategorizationRule,
  LocalCategory,
  LocalRecurringRule,
  LocalSavingsGoal,
  LocalSavingsGoalContribution,
  LocalTag,
  LocalTransaction,
  LocalTransactionTemplate,
} from '../types'
import {
  exportLocalBackup,
  parseLocalBackupPayload,
  previewLocalRestore,
  restoreLocalBackup,
  type CorvaleBackupPayload,
} from '../backup'

/**
 * Sprint 13.10 acceptance criteria: a backup exported from the local SQLite store must match the
 * server's `CorvaleBackupPayload` shape (`backend/utils/backupUtils.ts`) and restoring it must
 * preserve every FK invariant the server's `restoreUserBackup` guarantees - fresh ids, remapped
 * references, shared master categories reused rather than duplicated. This suite exercises a full
 * export -> restore round trip against two independent local databases (simulating "restore on a
 * different device/account"), the same scenario `backend/tests/backup.test.ts` covers server-side.
 */

const freshDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const nowIso = () => new Date().toISOString()

const accountsRepo = new Repository<LocalAccount>('accounts')
const transactionsRepo = new Repository<LocalTransaction>('transactions')
const categoriesRepo = new Repository<LocalCategory>('categories')
const budgetsRepo = new Repository<LocalBudget & { periodType: string; currency: string }>('budgets')
const goalsRepo = new Repository<LocalSavingsGoal & { currency: string }>('savingsGoals')
const contributionsRepo = new Repository<LocalSavingsGoalContribution & { type: string }>('savingsGoalContributions')
const rulesRepo = new Repository<LocalCategorizationRule>('categorizationRules')
const tagsRepo = new Repository<LocalTag>('tags')
const recurringRepo = new Repository<LocalRecurringRule>('recurringRules')
const templatesRepo = new Repository<LocalTransactionTemplate>('transactionTemplates')

let idCounter = 0
const nextId = (): string => {
  idCounter += 1
  return `id-${idCounter.toString().padStart(6, '0')}`
}

/** Seeds a "fully synced" source device: one master category (as if pulled down from the server,
 * `userId: null`), one custom category under it, two accounts, a tag, a budget, a savings goal +
 * one contribution, a recurring rule, a categorization rule, a template, a plain expense, a
 * transfer pair, and a split parent + two children - the same entity spread
 * `backend/tests/backup.test.ts`'s `seedFullUserData` covers. */
const seedFullSourceData = async (db: LocalDb, masterCategoryId: string) => {
  await categoriesRepo.upsertFromServer(db, [
    { _id: masterCategoryId, updatedAt: nowIso(), userId: null, masterCategoryId: null, name: 'Food', isArchived: false },
  ])

  const customCategoryId = nextId()
  await categoriesRepo.create(db, {
    _id: customCategoryId,
    updatedAt: nowIso(),
    userId: 'u1',
    masterCategoryId,
    name: 'Takeout',
    isArchived: false,
  })

  const checkingId = nextId()
  const savingsId = nextId()
  await accountsRepo.create(db, {
    _id: checkingId,
    updatedAt: nowIso(),
    userId: 'u1',
    workspaceId: null,
    name: 'Checking',
    type: 'checking',
    currency: 'USD',
    openingBalance: 1000,
    currentBalance: 1000,
    isArchived: false,
  })
  await accountsRepo.create(db, {
    _id: savingsId,
    updatedAt: nowIso(),
    userId: 'u1',
    workspaceId: null,
    name: 'Savings',
    type: 'savings',
    currency: 'USD',
    openingBalance: 500,
    currentBalance: 500,
    isArchived: false,
  })

  const tagId = nextId()
  await tagsRepo.create(db, { _id: tagId, updatedAt: nowIso(), userId: 'u1', name: 'Essential', color: '#00FF00' })

  const budgetId = nextId()
  await budgetsRepo.create(db, {
    _id: budgetId,
    updatedAt: nowIso(),
    userId: 'u1',
    workspaceId: null,
    name: 'January overall',
    periodType: 'monthly',
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-01-31T23:59:59.999Z',
    categoryId: customCategoryId,
    amount: 50000,
    currency: 'USD',
    accountIds: [checkingId],
    isArchived: false,
  })

  const goalId = nextId()
  await goalsRepo.create(db, {
    _id: goalId,
    updatedAt: nowIso(),
    userId: 'u1',
    workspaceId: null,
    name: 'Emergency fund',
    targetAmount: 100000,
    currentAmount: 0,
    currency: 'USD',
    targetDate: null,
    status: 'active',
    autoContribution: { enabled: false, amount: 0, interval: 'monthly' },
  })
  await contributionsRepo.create(db, {
    _id: nextId(),
    updatedAt: nowIso(),
    userId: 'u1',
    goalId,
    amount: 10000,
    type: 'manual',
    contributedAt: '2026-01-10T00:00:00.000Z',
  })

  const recurringId = nextId()
  await recurringRepo.create(db, {
    _id: recurringId,
    updatedAt: nowIso(),
    userId: 'u1',
    workspaceId: null,
    title: 'Electric bill',
    type: 'expense',
    amount: 8500,
    currency: 'USD',
    accountId: checkingId,
    categoryId: customCategoryId,
    interval: 'monthly',
    nextDueDate: '2026-03-01T00:00:00.000Z',
    isActive: true,
    isArchived: false,
    isCancelled: false,
  })

  await rulesRepo.create(db, {
    _id: nextId(),
    updatedAt: nowIso(),
    userId: 'u1',
    name: 'Takeout rule',
    matchType: 'description_contains',
    matchValue: 'takeout',
    categoryId: customCategoryId,
    priority: 0,
    isActive: true,
  })

  await templatesRepo.create(db, {
    _id: nextId(),
    updatedAt: nowIso(),
    userId: 'u1',
    name: 'Morning Coffee',
    type: 'expense',
    amount: 550,
    accountId: checkingId,
    categoryId: customCategoryId,
  })

  const expenseId = nextId()
  await transactionsRepo.create(db, {
    _id: expenseId,
    updatedAt: nowIso(),
    createdAt: nowIso(),
    userId: 'u1',
    workspaceId: null,
    accountId: checkingId,
    categoryId: customCategoryId,
    type: 'expense',
    status: 'posted',
    amount: 2250,
    title: 'Takeout dinner',
    date: '2026-01-15T12:00:00.000Z',
    clearedStatus: 'pending',
    splitTransactionId: null,
  })

  const outboundId = nextId()
  const inboundId = nextId()
  await transactionsRepo.create(db, {
    _id: outboundId,
    updatedAt: nowIso(),
    createdAt: nowIso(),
    userId: 'u1',
    workspaceId: null,
    accountId: checkingId,
    categoryId: masterCategoryId,
    type: 'transfer',
    status: 'posted',
    amount: 10000,
    title: 'Move to savings',
    date: '2026-01-16T12:00:00.000Z',
    clearedStatus: 'pending',
    splitTransactionId: null,
    transferPairId: inboundId,
  })
  await transactionsRepo.create(db, {
    _id: inboundId,
    updatedAt: nowIso(),
    createdAt: nowIso(),
    userId: 'u1',
    workspaceId: null,
    accountId: savingsId,
    categoryId: masterCategoryId,
    type: 'transfer',
    status: 'posted',
    amount: 10000,
    title: 'Move to savings',
    date: '2026-01-16T12:00:00.000Z',
    clearedStatus: 'pending',
    splitTransactionId: null,
    transferPairId: outboundId,
  })

  const splitParentId = nextId()
  await transactionsRepo.create(db, {
    _id: splitParentId,
    updatedAt: nowIso(),
    createdAt: nowIso(),
    userId: 'u1',
    workspaceId: null,
    accountId: checkingId,
    categoryId: masterCategoryId,
    type: 'expense',
    status: 'posted',
    amount: 10000,
    title: 'Mixed shopping trip',
    date: '2026-01-17T12:00:00.000Z',
    clearedStatus: 'pending',
    splitTransactionId: null,
  })
  await transactionsRepo.create(db, {
    _id: nextId(),
    updatedAt: nowIso(),
    createdAt: nowIso(),
    userId: 'u1',
    workspaceId: null,
    accountId: checkingId,
    categoryId: masterCategoryId,
    type: 'expense',
    status: 'posted',
    amount: 6000,
    title: 'Mixed shopping trip',
    date: '2026-01-17T12:00:00.000Z',
    clearedStatus: 'pending',
    splitTransactionId: splitParentId,
  })
  await transactionsRepo.create(db, {
    _id: nextId(),
    updatedAt: nowIso(),
    createdAt: nowIso(),
    userId: 'u1',
    workspaceId: null,
    accountId: checkingId,
    categoryId: customCategoryId,
    type: 'expense',
    status: 'posted',
    amount: 4000,
    title: 'Mixed shopping trip',
    date: '2026-01-17T12:00:00.000Z',
    clearedStatus: 'pending',
    splitTransactionId: splitParentId,
  })

  return { checkingId, savingsId, customCategoryId, budgetId, goalId, recurringId, outboundId, inboundId, splitParentId }
}

describe('domain/backup: exportLocalBackup', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
  })

  it('exports every syncable table in the server CorvaleBackupPayload shape, counts matching array lengths', async () => {
    const db = await freshDb()
    const masterCategoryId = nextId()
    await seedFullSourceData(db, masterCategoryId)

    const payload = await exportLocalBackup(db, { workspaceId: null })

    expect(payload.version).toBe(1)
    expect(payload.scope).toEqual({ workspaceId: null })
    expect(payload.accounts).toHaveLength(2)
    expect(payload.tags).toHaveLength(1)
    expect(payload.budgets).toHaveLength(1)
    expect(payload.savingsGoals).toHaveLength(1)
    expect(payload.savingsGoalContributions).toHaveLength(1)
    expect(payload.recurringRules).toHaveLength(1)
    expect(payload.categorizationRules).toHaveLength(1)
    expect(payload.transactionTemplates).toHaveLength(1)
    // expense + transfer pair (2) + split parent + 2 split children = 6
    expect(payload.transactions).toHaveLength(6)
    // custom "Takeout" category + the referenced "Food" master
    expect(payload.categories).toHaveLength(2)
    expect(payload.categories.some((c) => c.name === 'Takeout')).toBe(true)
    expect(payload.categories.some((c) => c.name === 'Food')).toBe(true)
    // receipts are never part of the local syncable entity set (see module header comment)
    expect(payload.receipts).toEqual([])

    expect(payload.counts.accounts).toBe(payload.accounts.length)
    expect(payload.counts.transactions).toBe(payload.transactions.length)

    for (const account of payload.accounts) {
      expect(account.id).toBeDefined()
      expect(account._id).toBeUndefined()
      expect(account.userId).toBeUndefined()
    }
  })

  it('scopes accounts/transactions/budgets/savingsGoals/recurringRules to the requested workspace, but not tags/rules/templates', async () => {
    const db = await freshDb()
    const masterCategoryId = nextId()
    await seedFullSourceData(db, masterCategoryId)

    const workspacePersonalPayload = await exportLocalBackup(db, { workspaceId: null })
    const workspaceScopedPayload = await exportLocalBackup(db, { workspaceId: 'ws-does-not-exist' })

    // Nothing in this fixture belongs to 'ws-does-not-exist', so the workspace-scoped export is empty
    // for the workspace-aware tables...
    expect(workspaceScopedPayload.accounts).toHaveLength(0)
    expect(workspaceScopedPayload.transactions).toHaveLength(0)
    expect(workspaceScopedPayload.budgets).toHaveLength(0)
    expect(workspaceScopedPayload.savingsGoals).toHaveLength(0)
    // ...but tags/categorizationRules/transactionTemplates are personal-only on the server (no
    // workspaceId field) and always export in full regardless of the requested scope.
    expect(workspaceScopedPayload.tags).toHaveLength(1)
    expect(workspaceScopedPayload.categorizationRules).toHaveLength(1)
    expect(workspaceScopedPayload.transactionTemplates).toHaveLength(1)

    expect(workspacePersonalPayload.accounts).toHaveLength(2)
  })
})

describe('domain/backup: parseLocalBackupPayload', () => {
  it('rejects an unsupported version', () => {
    expect(() => parseLocalBackupPayload({ version: 99, accounts: [] })).toThrow(/unsupported/i)
  })

  it('rejects a payload missing required arrays', () => {
    expect(() => parseLocalBackupPayload({ version: 1, accounts: [] })).toThrow(/not a valid corvale backup/i)
  })

  it('accepts a well-formed payload', async () => {
    const db = await freshDb()
    const payload = await exportLocalBackup(db, { workspaceId: null })
    expect(() => parseLocalBackupPayload(JSON.parse(JSON.stringify(payload)))).not.toThrow()
  })
})

describe('domain/backup: previewLocalRestore', () => {
  it('warns when receipt metadata is present (server ZIP export restored locally)', async () => {
    const db = await freshDb()
    const payload = await exportLocalBackup(db, { workspaceId: null })
    const withReceipts: CorvaleBackupPayload = { ...payload, receipts: [{ id: 'r1', originalFilename: 'x.png' }] }

    const preview = previewLocalRestore(db, withReceipts, null)
    expect(preview.valid).toBe(true)
    expect(preview.warnings.some((w) => /receipt/i.test(w))).toBe(true)
  })

  it('warns on a personal <-> workspace scope mismatch', async () => {
    const db = await freshDb()
    const payload = await exportLocalBackup(db, { workspaceId: null })

    const preview = previewLocalRestore(db, payload, 'ws-1')
    expect(preview.warnings.some((w) => /workspace/i.test(w))).toBe(true)
  })
})

describe('domain/backup: restoreLocalBackup round trip', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
  })

  it('restores a full backup into a different local database with remapped ids and preserved FK integrity', async () => {
    const sourceDb = await freshDb()
    const masterCategoryId = nextId()
    const seeded = await seedFullSourceData(sourceDb, masterCategoryId)

    const payload = await exportLocalBackup(sourceDb, { workspaceId: null })

    // Target device: already synced the same shared master category (real installs pull this down
    // via bootstrap before any restore is possible), but has none of the user's own data yet.
    const targetDb = await freshDb()
    await categoriesRepo.upsertFromServer(targetDb, [
      { _id: masterCategoryId, updatedAt: nowIso(), userId: null, masterCategoryId: null, name: 'Food', isArchived: false },
    ])

    const result = await restoreLocalBackup(targetDb, payload, { userId: 'u2', targetWorkspaceId: null })

    expect(result.created.accounts).toBe(2)
    expect(result.created.transactions).toBe(6)
    expect(result.created.categories).toBe(1) // only the custom "Takeout" category - master is reused
    expect(result.created.tags).toBe(1)
    expect(result.created.budgets).toBe(1)
    expect(result.created.savingsGoals).toBe(1)
    expect(result.created.savingsGoalContributions).toBe(1)
    expect(result.created.recurringRules).toBe(1)
    expect(result.created.categorizationRules).toBe(1)
    expect(result.created.transactionTemplates).toBe(1)

    // fresh ids: no restored account reuses a source id
    const restoredAccounts = (await accountsRepo.list(targetDb)).filter((a) => a.userId === 'u2')
    expect(restoredAccounts).toHaveLength(2)
    expect(Object.values(result.idMapping)).not.toContain(seeded.checkingId)
    expect(Object.values(result.idMapping)).not.toContain(seeded.savingsId)

    // the shared master category was not duplicated
    const targetCategories = await categoriesRepo.list(targetDb)
    expect(targetCategories.filter((c) => c.userId === null)).toHaveLength(1)
    expect(targetCategories.filter((c) => c.userId === 'u2')).toHaveLength(1)

    // every restored transaction points at a newly created target account
    const restoredTransactions = await transactionsRepo.list(targetDb)
    const restoredUserTx = restoredTransactions.filter((t) => t.userId === 'u2')
    expect(restoredUserTx).toHaveLength(6)
    const restoredAccountIds = new Set(restoredAccounts.map((a) => a._id))
    for (const tx of restoredUserTx) {
      expect(restoredAccountIds.has(tx.accountId)).toBe(true)
    }

    // transfer pair: each restored leg's transferPairId resolves to the other leg's fresh id
    const restoredTransfer = restoredUserTx.find((t) => t.type === 'transfer' && t.title === 'Move to savings')
    expect(restoredTransfer?.transferPairId).toBeTruthy()
    const pair = restoredUserTx.find((t) => t._id === restoredTransfer?.transferPairId)
    expect(pair).toBeDefined()
    expect(pair?.transferPairId).toBe(restoredTransfer?._id)

    // split parent/children: children point at the new parent id, amounts still sum correctly
    const restoredParent = restoredUserTx.find((t) => t.title === 'Mixed shopping trip' && t.splitTransactionId === null)
    expect(restoredParent).toBeDefined()
    const restoredChildren = restoredUserTx.filter((t) => t.splitTransactionId === restoredParent?._id)
    expect(restoredChildren).toHaveLength(2)
    expect(restoredChildren.reduce((sum, c) => sum + c.amount, 0)).toBe(restoredParent?.amount)

    // budget/recurringRule/categorizationRule/template all resolve to the newly created custom category
    const customCategory = targetCategories.find((c) => c.userId === 'u2')
    const restoredBudgets = await budgetsRepo.list(targetDb)
    expect(restoredBudgets[0].categoryId).toBe(customCategory?._id)
    const restoredRecurring = await recurringRepo.list(targetDb)
    expect(restoredRecurring[0].categoryId).toBe(customCategory?._id)
    expect(restoredAccountIds.has(restoredRecurring[0].accountId)).toBe(true)
  })

  it('rejects a backup containing a broken category reference', async () => {
    const sourceDb = await freshDb()
    const masterCategoryId = nextId()
    await seedFullSourceData(sourceDb, masterCategoryId)
    const payload = await exportLocalBackup(sourceDb, { workspaceId: null })

    const tampered: CorvaleBackupPayload = {
      ...payload,
      transactions: payload.transactions.map((t) => ({ ...t, categoryId: 'not-a-real-id' })),
    }

    const targetDb = await freshDb()
    await categoriesRepo.upsertFromServer(targetDb, [
      { _id: masterCategoryId, updatedAt: nowIso(), userId: null, masterCategoryId: null, name: 'Food', isArchived: false },
    ])

    await expect(restoreLocalBackup(targetDb, tampered, { userId: 'u2', targetWorkspaceId: null })).rejects.toThrow(
      /broken reference/i
    )
  })

  it('rejects restoring an unsupported backup version', async () => {
    const sourceDb = await freshDb()
    const payload = await exportLocalBackup(sourceDb, { workspaceId: null })
    const badPayload = { ...payload, version: 2 } as unknown as CorvaleBackupPayload

    const targetDb = await freshDb()
    await expect(restoreLocalBackup(targetDb, badPayload, { userId: 'u2', targetWorkspaceId: null })).rejects.toThrow()
  })

  it('blocks a workspace-scoped restore while offline, per the outbox workspace-write guard', async () => {
    const sourceDb = await freshDb()
    await accountsRepo.create(sourceDb, {
      _id: nextId(),
      updatedAt: nowIso(),
      userId: 'u1',
      workspaceId: 'ws-1',
      name: 'Shared checking',
      type: 'checking',
      currency: 'USD',
      openingBalance: 100,
      currentBalance: 100,
      isArchived: false,
    })
    const payload = await exportLocalBackup(sourceDb, { workspaceId: 'ws-1' })
    expect(payload.accounts).toHaveLength(1)

    const targetDb = await freshDb()
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })

    await expect(
      restoreLocalBackup(targetDb, payload, { userId: 'u2', targetWorkspaceId: 'ws-1' })
    ).rejects.toThrow(/offline/i)

    expect(await accountsRepo.list(targetDb)).toHaveLength(0)
  })
})
