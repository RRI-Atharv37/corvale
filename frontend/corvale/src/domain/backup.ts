import type { LocalDb } from '../db/LocalDb'
import { Repository } from '../db/repositories/Repository'
import { generateLocalObjectId } from '../db/generateLocalId'
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
} from './types'
import type { BackupEntityCounts, BackupRestorePreview, BackupRestoreResult } from '../types/api'

/**
 * Local (SQLite) port of `backend/utils/backupUtils.ts` for Sprint 13.10 - generates the exact same
 * `CorvaleBackupPayload` JSON shape as the server's `/backup/export` (`backend/utils/backupUtils.ts`) so a file exported on one device
 * (local or server) can be restored on the other. Only the syncable-entity tables are covered here;
 * `Receipt` records are never part of the local sync entity set (see `db/repositories/Repository.ts`'s
 * `SyncableTableName`), so `receipts` is always `[]` locally - binary receipts depend on the separate
 * receipt-blob-cache work (also Sprint 13.10, different surface). A locally-produced backup therefore
 * never round-trips receipt metadata, matching a JSON (non-ZIP) export from the server.
 */

export const BACKUP_VERSION = 1 as const
/** Mirrors `backend/utils/backupUtils.ts`'s `BACKUP_MAX_JSON_BYTES` - no ZIP mode locally (no
 * client-side archiver dependency and no receipt files to bundle), so only the JSON cap applies. */
export const LOCAL_BACKUP_MAX_JSON_BYTES = 10 * 1024 * 1024

export interface LocalBackupScope {
  workspaceId: string | null
}

export interface CorvaleBackupPayload {
  version: typeof BACKUP_VERSION
  exportedAt: string
  scope: LocalBackupScope
  counts: BackupEntityCounts
  accounts: Record<string, unknown>[]
  categories: Record<string, unknown>[]
  tags: Record<string, unknown>[]
  budgets: Record<string, unknown>[]
  savingsGoals: Record<string, unknown>[]
  savingsGoalContributions: Record<string, unknown>[]
  recurringRules: Record<string, unknown>[]
  categorizationRules: Record<string, unknown>[]
  transactionTemplates: Record<string, unknown>[]
  transactions: Record<string, unknown>[]
  receipts: Record<string, unknown>[]
}

/**
 * `LocalXxx` types in `domain/types.ts` only declare the fields Sprint 13.5's domain engine reads -
 * every other field on the original server document round-trips fine through the JSON `data` blob
 * (`db/repositories/Repository.ts` stores the full doc). Widened here the same way
 * `pages/Dashboard/hooks/use*Data.ts` already do, rather than touching `domain/types.ts` (owned by
 * 13.5 infra) - see e.g. `useBudgetsData.ts`'s identical `LocalBudgetRecord`.
 */
interface LocalCategoryRecord extends LocalCategory {
  icon?: string
  sortOrder?: number
}
interface LocalBudgetRecord extends LocalBudget {
  periodType?: string
  currency?: string
  rollover?: boolean
}
interface LocalSavingsGoalRecord extends LocalSavingsGoal {
  currency?: string
  accountId?: string | null
  completedAt?: string | null
}
interface LocalSavingsGoalContributionRecord extends LocalSavingsGoalContribution {
  type?: string
  note?: string
}
interface LocalTransactionRecord extends LocalTransaction {
  currency?: string
  recurringPaymentId?: string | null
  receiptIds?: string[]
}

const accountsRepo = new Repository<LocalAccount>('accounts')
const transactionsRepo = new Repository<LocalTransactionRecord>('transactions')
const categoriesRepo = new Repository<LocalCategoryRecord>('categories')
const budgetsRepo = new Repository<LocalBudgetRecord>('budgets')
const goalsRepo = new Repository<LocalSavingsGoalRecord>('savingsGoals')
const contributionsRepo = new Repository<LocalSavingsGoalContributionRecord>('savingsGoalContributions')
const rulesRepo = new Repository<LocalCategorizationRule>('categorizationRules')
const tagsRepo = new Repository<LocalTag>('tags')
const recurringRepo = new Repository<LocalRecurringRule>('recurringRules')
const templatesRepo = new Repository<LocalTransactionTemplate>('transactionTemplates')

const emptyCounts = (): BackupEntityCounts => ({
  accounts: 0,
  categories: 0,
  tags: 0,
  budgets: 0,
  savingsGoals: 0,
  savingsGoalContributions: 0,
  recurringRules: 0,
  categorizationRules: 0,
  transactionTemplates: 0,
  transactions: 0,
  receipts: 0,
})

const buildCounts = (payload: Pick<CorvaleBackupPayload, keyof BackupEntityCounts>): BackupEntityCounts => ({
  accounts: payload.accounts.length,
  categories: payload.categories.length,
  tags: payload.tags.length,
  budgets: payload.budgets.length,
  savingsGoals: payload.savingsGoals.length,
  savingsGoalContributions: payload.savingsGoalContributions.length,
  recurringRules: payload.recurringRules.length,
  categorizationRules: payload.categorizationRules.length,
  transactionTemplates: payload.transactionTemplates.length,
  transactions: payload.transactions.length,
  receipts: payload.receipts.length,
})

/** Mirrors `backend/utils/backupUtils.ts`'s `serializeDoc`: renames `_id` -> `id`, drops `userId`
 * (scope is implicit - the whole local DB belongs to one signed-in user), everything else is copied
 * verbatim. Local rows already store dates as ISO strings and amounts in minor units (matching the
 * server's raw DB representation - see `useBudgetsData.ts`'s header comment on why sync payloads are
 * minor units), so no conversion is needed for parity with the server export. */
const serializeLocalDoc = (doc: { _id: string }): Record<string, unknown> => {
  const { _id, userId: _userId, ...rest } = doc as unknown as Record<string, unknown>
  return { id: _id, ...rest }
}

const scopeFilter = <T extends { workspaceId?: string | null }>(rows: T[], workspaceId: string | null): T[] =>
  rows.filter((row) => (workspaceId ? row.workspaceId === workspaceId : !row.workspaceId))

/**
 * Local equivalent of `backend/utils/backupUtils.ts`'s `exportUserBackup`. Dumps every syncable
 * table (soft-deleted rows already excluded - `Repository.list` filters `deletedAt IS NULL`) into
 * the same versioned JSON shape as the server export. `tags`/`categorizationRules`/
 * `transactionTemplates`/`savingsGoalContributions` are never workspace-scoped on the server (no
 * `workspaceId` field on those models), so - like the server - they are exported in full regardless
 * of `scope.workspaceId`; `accounts`/`transactions`/`budgets`/`savingsGoals`/`recurringRules` are
 * filtered to the requested scope.
 */
export const exportLocalBackup = async (db: LocalDb, scope: LocalBackupScope): Promise<CorvaleBackupPayload> => {
  const workspaceId = scope.workspaceId

  const [accounts, transactions, budgets, savingsGoals, recurringRules, categories, tags, categorizationRules, transactionTemplates] =
    await Promise.all([
      accountsRepo.list(db),
      transactionsRepo.list(db),
      budgetsRepo.list(db),
      goalsRepo.list(db),
      recurringRepo.list(db),
      categoriesRepo.list(db),
      tagsRepo.list(db),
      rulesRepo.list(db),
      templatesRepo.list(db),
    ])

  const scopedAccounts = scopeFilter(accounts, workspaceId)
  const scopedTransactions = scopeFilter(transactions, workspaceId)
  const scopedBudgets = scopeFilter(budgets, workspaceId)
  const scopedGoals = scopeFilter(savingsGoals, workspaceId)
  const scopedRecurring = scopeFilter(recurringRules, workspaceId)

  const goalIds = new Set(scopedGoals.map((goal) => goal._id))
  const allContributions = await contributionsRepo.list(db)
  const scopedContributions = allContributions.filter((contribution) => goalIds.has(contribution.goalId))

  // Categories mirror the server: user's own categories plus only the master categories they (and
  // the other scoped entities) actually reference - see `exportUserBackup`'s `categoryIds` set.
  const userCategories = categories.filter((category) => category.userId !== null)
  const masterCategories = categories.filter((category) => category.userId === null)

  const referencedCategoryIds = new Set<string>()
  for (const category of userCategories) {
    if (category.masterCategoryId) referencedCategoryIds.add(category.masterCategoryId)
  }
  for (const transaction of scopedTransactions) referencedCategoryIds.add(transaction.categoryId)
  for (const budget of scopedBudgets) {
    if (budget.categoryId) referencedCategoryIds.add(budget.categoryId)
  }
  for (const rule of scopedRecurring) referencedCategoryIds.add(rule.categoryId)
  for (const rule of categorizationRules) referencedCategoryIds.add(rule.categoryId)
  for (const template of transactionTemplates) referencedCategoryIds.add(template.categoryId)

  const referencedMasters = masterCategories.filter((category) => referencedCategoryIds.has(category._id))
  const exportedCategories = [...userCategories, ...referencedMasters]

  const payload: CorvaleBackupPayload = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    scope: { workspaceId },
    counts: emptyCounts(),
    accounts: scopedAccounts.map(serializeLocalDoc),
    categories: exportedCategories.map(serializeLocalDoc),
    tags: tags.map(serializeLocalDoc),
    budgets: scopedBudgets.map(serializeLocalDoc),
    savingsGoals: scopedGoals.map(serializeLocalDoc),
    savingsGoalContributions: scopedContributions.map(serializeLocalDoc),
    recurringRules: scopedRecurring.map(serializeLocalDoc),
    categorizationRules: categorizationRules.map(serializeLocalDoc),
    transactionTemplates: transactionTemplates.map(serializeLocalDoc),
    transactions: scopedTransactions.map(serializeLocalDoc),
    // Receipt metadata/files are out of scope for the local store - see module header comment.
    receipts: [],
  }

  payload.counts = buildCounts(payload)
  return payload
}

const REQUIRED_ARRAYS = [
  'accounts',
  'categories',
  'tags',
  'budgets',
  'savingsGoals',
  'savingsGoalContributions',
  'recurringRules',
  'categorizationRules',
  'transactionTemplates',
  'transactions',
  'receipts',
] as const

/** Mirrors `backend/utils/backupUtils.ts`'s `parseBackupPayload` exactly - same version check, same
 * required-array shape check, same error strings (`utils/errorMessages.ts`'s `ERROR_MESSAGES.BACKUP`
 * on the backend has no frontend equivalent, so the literal strings are inlined here). */
export const parseLocalBackupPayload = (raw: unknown): CorvaleBackupPayload => {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Backup file is not a valid Corvale backup')
  }

  const backup = raw as Partial<CorvaleBackupPayload>

  if (backup.version !== BACKUP_VERSION) {
    throw new Error('Unsupported backup version')
  }

  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(backup[key])) {
      throw new Error('Backup file is not a valid Corvale backup')
    }
  }

  return backup as CorvaleBackupPayload
}

/**
 * Local equivalent of `backend/utils/backupUtils.ts`'s `previewBackupRestore` - a pure report of
 * what a restore would create, with no local writes. `db` is accepted (rather than a bare function
 * of `backup`/`targetWorkspaceId`) for signature symmetry with `restoreLocalBackup` and so a future
 * sprint can diff against existing local data without changing every call site; it is currently
 * unused, exactly like the server version never touches the DB in its preview path either.
 */
export const previewLocalRestore = (
  _db: LocalDb,
  backup: CorvaleBackupPayload,
  targetWorkspaceId: string | null
): BackupRestorePreview => {
  const warnings: string[] = []
  const errors: string[] = []

  if (backup.version !== BACKUP_VERSION) {
    errors.push(`Unsupported backup version: ${backup.version}`)
  }

  const sourceWorkspaceId = backup.scope?.workspaceId ?? null
  if (sourceWorkspaceId !== targetWorkspaceId) {
    warnings.push(
      targetWorkspaceId
        ? 'Restoring into a workspace that differs from the export scope.'
        : 'Restoring into personal data from a workspace export (or vice versa).'
    )
  }

  if (backup.receipts.length > 0) {
    warnings.push(
      'Receipt metadata is included, but receipt files are not restored by the local backup - restore this file on the server, or via a ZIP export, to bring receipts back.'
    )
  }

  if (targetWorkspaceId && typeof navigator !== 'undefined' && !navigator.onLine) {
    warnings.push('You are offline - restoring workspace data requires connectivity and will fail until you reconnect.')
  }

  const counts = buildCounts(backup)

  return {
    valid: errors.length === 0,
    version: backup.version,
    exportedAt: backup.exportedAt ?? null,
    sourceScope: { workspaceId: sourceWorkspaceId },
    targetScope: { workspaceId: targetWorkspaceId },
    counts,
    warnings,
    errors,
  }
}

export interface LocalBackupRestoreOptions {
  userId: string
  targetWorkspaceId: string | null
}

const asString = (value: unknown): string => String(value)
const asOptionalString = (value: unknown): string | undefined =>
  value == null || value === '' ? undefined : String(value)
const asNumber = (value: unknown, fallback = 0): number => (typeof value === 'number' ? value : Number(value ?? fallback))
const asBoolean = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : (value as boolean) ?? fallback)

/**
 * Local equivalent of `backend/utils/backupUtils.ts`'s `restoreUserBackup` - same entity order, same
 * id-remapping invariant (every restored row gets a fresh `generateLocalObjectId()`, with every FK
 * reference rewritten through a single shared `idMap`, exactly mirroring the backend's one-`idMap`-
 * for-everything design), and the same pass-through rule for shared master categories. Writes go
 * through `Repository.create`, so every restored row is captured by the outbox for sync (Sprint
 * 13.6) - which also means a workspace-scoped restore attempted while offline fails naturally via
 * `Outbox.enqueue`'s existing "Workspace-scoped writes require connectivity" guard the moment the
 * first workspace-scoped row is created. The whole restore runs inside one `db.transaction`, so that
 * failure (or any other) rolls back every row written so far - stronger than the backend's restore,
 * which has no transactional rollback at all; this is a deliberate improvement, not a parity gap.
 */
export const restoreLocalBackup = async (
  db: LocalDb,
  backup: CorvaleBackupPayload,
  options: LocalBackupRestoreOptions
): Promise<BackupRestoreResult> => {
  const preview = previewLocalRestore(db, backup, options.targetWorkspaceId)
  if (!preview.valid) {
    throw new Error(preview.errors.join(' '))
  }

  if (options.targetWorkspaceId && typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Workspace-scoped writes require connectivity - you are offline')
  }

  const idMap = new Map<string, string>()
  const created = emptyCounts()

  const existingCategories = await categoriesRepo.list(db)
  const masterCategoryIds = new Set(
    existingCategories.filter((category) => category.userId === null && category.masterCategoryId === null).map((c) => c._id)
  )

  const mapOptionalId = (value: unknown): string | null => {
    if (value == null || value === '') return null
    const id = String(value)
    if (masterCategoryIds.has(id)) return id
    const mapped = idMap.get(id)
    if (!mapped) throw new Error('Backup contains a broken reference and cannot be restored')
    return mapped
  }
  const mapRequiredId = (value: unknown): string => {
    const mapped = mapOptionalId(value)
    if (!mapped) throw new Error('Backup contains a broken reference and cannot be restored')
    return mapped
  }
  const mapIdArray = (values: unknown): string[] => {
    if (!Array.isArray(values)) return []
    return values.map((value) => mapOptionalId(value)).filter((value): value is string => value != null)
  }

  await db.transaction(async (tx) => {
    const nowIso = () => new Date().toISOString()

    // Categories: pass-through for shared master categories, fresh row for custom ones.
    for (const record of backup.categories) {
      const sourceId = asString(record.id)
      if (masterCategoryIds.has(sourceId)) {
        idMap.set(sourceId, sourceId)
        continue
      }
      const newId = generateLocalObjectId()
      const doc: LocalCategoryRecord = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        masterCategoryId: mapOptionalId(record.masterCategoryId),
        name: asString(record.name),
        color: asOptionalString(record.color),
        icon: asOptionalString(record.icon),
        sortOrder: record.sortOrder != null ? asNumber(record.sortOrder) : undefined,
        isArchived: asBoolean(record.isArchived, false),
      }
      await categoriesRepo.create(tx, doc)
      idMap.set(sourceId, newId)
      created.categories += 1
    }

    // Tags: dedup by name against what's already local, matching the server's `Tag.findOne` check.
    const existingTags = await tagsRepo.list(tx)
    for (const record of backup.tags) {
      const sourceId = asString(record.id)
      const existing = existingTags.find((tag) => tag.name === record.name)
      if (existing) {
        idMap.set(sourceId, existing._id)
        continue
      }
      const newId = generateLocalObjectId()
      const doc: LocalTag = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        name: asString(record.name),
        color: asOptionalString(record.color),
      }
      await tagsRepo.create(tx, doc)
      idMap.set(sourceId, newId)
      existingTags.push(doc)
      created.tags += 1
    }

    // Accounts (never remap workspaceId - always the current restore target, mirroring the backend).
    for (const record of backup.accounts) {
      const sourceId = asString(record.id)
      const newId = generateLocalObjectId()
      const doc: LocalAccount = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        workspaceId: options.targetWorkspaceId,
        name: asString(record.name),
        type: record.type as LocalAccount['type'],
        currency: asString(record.currency),
        openingBalance: asNumber(record.openingBalance, 0),
        currentBalance: asNumber(record.currentBalance ?? record.openingBalance, 0),
        isArchived: asBoolean(record.isArchived, false),
      }
      await accountsRepo.create(tx, doc)
      idMap.set(sourceId, newId)
      created.accounts += 1
    }

    // Budgets
    for (const record of backup.budgets) {
      const sourceId = asString(record.id)
      const newId = generateLocalObjectId()
      const doc: LocalBudgetRecord = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        workspaceId: options.targetWorkspaceId,
        name: asOptionalString(record.name),
        periodType: asOptionalString(record.periodType),
        periodStart: asString(record.periodStart),
        periodEnd: asString(record.periodEnd),
        categoryId: mapOptionalId(record.categoryId),
        amount: asNumber(record.amount, 0),
        currency: asOptionalString(record.currency),
        rollover: asBoolean(record.rollover, false),
        accountIds: mapIdArray(record.accountIds),
        isArchived: asBoolean(record.isArchived, false),
      }
      await budgetsRepo.create(tx, doc)
      idMap.set(sourceId, newId)
      created.budgets += 1
    }

    // Savings goals
    for (const record of backup.savingsGoals) {
      const sourceId = asString(record.id)
      const newId = generateLocalObjectId()
      const doc: LocalSavingsGoalRecord = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        workspaceId: options.targetWorkspaceId,
        name: asString(record.name),
        targetAmount: asNumber(record.targetAmount, 0),
        currentAmount: asNumber(record.currentAmount, 0),
        currency: asOptionalString(record.currency),
        targetDate: (record.targetDate as string | null) ?? null,
        status: (record.status as LocalSavingsGoal['status']) ?? 'active',
        accountId: mapOptionalId(record.accountId),
        autoContribution: (record.autoContribution as LocalSavingsGoal['autoContribution']) ?? {
          enabled: false,
          amount: 0,
          interval: 'monthly',
        },
        completedAt: (record.completedAt as string | null) ?? null,
      }
      await goalsRepo.create(tx, doc)
      idMap.set(sourceId, newId)
      created.savingsGoals += 1
    }

    // Recurring rules
    for (const record of backup.recurringRules) {
      const sourceId = asString(record.id)
      const newId = generateLocalObjectId()
      const doc: LocalRecurringRule = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        workspaceId: options.targetWorkspaceId,
        title: asString(record.title),
        type: record.type as LocalRecurringRule['type'],
        amount: asNumber(record.amount, 0),
        currency: asString(record.currency),
        accountId: mapRequiredId(record.accountId),
        categoryId: mapRequiredId(record.categoryId),
        interval: record.interval as LocalRecurringRule['interval'],
        customIntervalDays: record.customIntervalDays as number | undefined,
        nextDueDate: asString(record.nextDueDate),
        description: asOptionalString(record.description),
        paymentMethod: asOptionalString(record.paymentMethod),
        tags: (record.tags as string[] | undefined) ?? [],
        isActive: asBoolean(record.isActive, true),
        isArchived: asBoolean(record.isArchived, false),
        isCancelled: asBoolean(record.isCancelled, false),
      }
      await recurringRepo.create(tx, doc)
      idMap.set(sourceId, newId)
      created.recurringRules += 1
    }

    // Categorization rules
    for (const record of backup.categorizationRules) {
      const sourceId = asString(record.id)
      const newId = generateLocalObjectId()
      const doc: LocalCategorizationRule = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        name: asString(record.name),
        matchType: record.matchType as LocalCategorizationRule['matchType'],
        matchValue: asOptionalString(record.matchValue),
        amountMin: record.amountMin as number | undefined,
        amountMax: record.amountMax as number | undefined,
        accountId: record.accountId ? (mapOptionalId(record.accountId) ?? undefined) : undefined,
        categoryId: mapRequiredId(record.categoryId),
        tags: (record.tags as string[] | undefined) ?? [],
        priority: asNumber(record.priority, 0),
        isActive: asBoolean(record.isActive, true),
      }
      await rulesRepo.create(tx, doc)
      idMap.set(sourceId, newId)
      created.categorizationRules += 1
    }

    // Transaction templates
    for (const record of backup.transactionTemplates) {
      const sourceId = asString(record.id)
      const newId = generateLocalObjectId()
      const doc: LocalTransactionTemplate = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        name: asString(record.name),
        type: record.type as LocalTransactionTemplate['type'],
        amount: asNumber(record.amount, 0),
        accountId: mapRequiredId(record.accountId),
        categoryId: mapRequiredId(record.categoryId),
        tags: (record.tags as string[] | undefined) ?? [],
        description: asOptionalString(record.description),
      }
      await templatesRepo.create(tx, doc)
      idMap.set(sourceId, newId)
      created.transactionTemplates += 1
    }

    // Transactions: create first with direct FKs, then a deferred pass patches transfer/split/
    // recurring cross-references once every transaction has a fresh id in `idMap` - mirrors the
    // backend's two-pass approach exactly (a transfer's pair, or a split's parent, may not have
    // been created yet when its sibling row is first written).
    const deferred: { sourceId: string; transferPairId?: unknown; splitTransactionId?: unknown; recurringPaymentId?: unknown }[] =
      []

    for (const record of backup.transactions) {
      const sourceId = asString(record.id)
      const newId = generateLocalObjectId()
      const doc: LocalTransactionRecord = {
        _id: newId,
        updatedAt: nowIso(),
        createdAt: nowIso(),
        userId: options.userId,
        workspaceId: options.targetWorkspaceId,
        accountId: mapRequiredId(record.accountId),
        categoryId: mapRequiredId(record.categoryId),
        type: record.type as LocalTransactionRecord['type'],
        status: (record.status as LocalTransactionRecord['status']) ?? 'posted',
        amount: asNumber(record.amount, 0),
        currency: asOptionalString(record.currency),
        title: asString(record.title),
        description: asOptionalString(record.description),
        date: asString(record.date),
        clearedStatus: 'pending',
        tags: (record.tags as string[] | undefined) ?? [],
        paymentMethod: asOptionalString(record.paymentMethod),
        source: asOptionalString(record.source),
        // Left null on the initial write; patched below once sibling ids exist.
        splitTransactionId: null,
        transferPairId: null,
      }
      await transactionsRepo.create(tx, doc)
      idMap.set(sourceId, newId)
      created.transactions += 1

      if (record.transferPairId || record.splitTransactionId || record.recurringPaymentId) {
        deferred.push({
          sourceId,
          transferPairId: record.transferPairId,
          splitTransactionId: record.splitTransactionId,
          recurringPaymentId: record.recurringPaymentId,
        })
      }
    }

    for (const update of deferred) {
      const newId = idMap.get(update.sourceId)
      if (!newId) continue

      const existing = await transactionsRepo.findById(tx, newId)
      if (!existing) continue

      const patched: LocalTransactionRecord = { ...(existing as LocalTransactionRecord) }
      if (update.transferPairId) patched.transferPairId = mapOptionalId(update.transferPairId)
      if (update.splitTransactionId) patched.splitTransactionId = mapOptionalId(update.splitTransactionId)
      if (update.recurringPaymentId) {
        // Non-fatal: recurring draft generation is server-authoritative (Sprint 13.9), so this link
        // is best-effort fidelity for a cross-restore from a server export, not load-bearing for any
        // local computation today.
        try {
          patched.recurringPaymentId = mapOptionalId(update.recurringPaymentId)
        } catch {
          patched.recurringPaymentId = null
        }
      }
      await transactionsRepo.update(tx, patched, existing.updatedAt)
    }

    // Savings goal contributions
    for (const record of backup.savingsGoalContributions) {
      const newId = generateLocalObjectId()
      const doc: LocalSavingsGoalContributionRecord = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        goalId: mapRequiredId(record.goalId),
        amount: asNumber(record.amount, 0),
        type: asOptionalString(record.type),
        note: asOptionalString(record.note),
        contributedAt: asString(record.contributedAt),
      }
      await contributionsRepo.create(tx, doc)
      created.savingsGoalContributions += 1
    }
  })

  return {
    created,
    idMapping: Object.fromEntries(idMap.entries()),
  }
}
