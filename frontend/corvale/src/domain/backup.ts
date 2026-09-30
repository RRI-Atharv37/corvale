import type { LocalDb } from '@platform/db/LocalDb'
import { Repository, enqueueGroupedTransactionCreate } from '@platform/db/repositories/Repository'
import { generateLocalObjectId } from '@platform/db/generateLocalId'
import { fromMinorUnits } from '@shared/money'
import { isTransferRole } from '@shared/transferDirection'
import { persistLocalAccountBalance } from './accountBalances'
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
import type { BackupEntityCounts, BackupRestorePreview, BackupRestoreResult } from '@lib/types/api'

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
 * `transactionTemplates`/`savingsGoalContributions` have no `workspaceId` field on the server, so -
 * like the server - they are not filtered by it; rules and templates that name an account outside
 * the requested scope are left out, as they could not be restored from it. `accounts`/`transactions`/
 * `budgets`/`savingsGoals`/`recurringRules` are filtered to the requested scope.
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

  const scopedAccountIds = new Set(scopedAccounts.map((account) => account._id))
  const scopedRules = categorizationRules.filter((rule) => !rule.accountId || scopedAccountIds.has(rule.accountId))
  const scopedTemplates = transactionTemplates.filter((template) => scopedAccountIds.has(template.accountId))

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
  for (const rule of scopedRules) referencedCategoryIds.add(rule.categoryId)
  for (const template of scopedTemplates) referencedCategoryIds.add(template.categoryId)

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
    categorizationRules: scopedRules.map(serializeLocalDoc),
    transactionTemplates: scopedTemplates.map(serializeLocalDoc),
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

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i
const BROKEN_REFERENCE_MESSAGE = 'Backup contains a broken reference and cannot be restored'

const asString = (value: unknown): string => String(value)
const asOptionalString = (value: unknown): string | undefined =>
  value == null || value === '' ? undefined : String(value)
const asNumber = (value: unknown, fallback = 0): number => (typeof value === 'number' ? value : Number(value ?? fallback))
const asBoolean = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : (value as boolean) ?? fallback)

/**
 * Local equivalent of `backend/utils/backupUtils.ts`'s `restoreUserBackup` - same entity order, same
 * id-remapping invariant (every restored row gets a fresh `generateLocalObjectId()`, with every FK
 * reference rewritten through a single shared `idMap`, exactly mirroring the backend's one-`idMap`-
 * for-everything design), and the same pass-through rule for shared master categories. Every
 * restored row is captured by the outbox for sync (Sprint 13.6) - transfers and splits as one
 * grouped op each, the shape the server requires - which also means a workspace-scoped restore
 * attempted while offline fails naturally via
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
    if (!mapped) throw new Error(BROKEN_REFERENCE_MESSAGE)
    return mapped
  }
  const mapRequiredId = (value: unknown): string => {
    const mapped = mapOptionalId(value)
    if (!mapped) throw new Error(BROKEN_REFERENCE_MESSAGE)
    return mapped
  }
  const otherCategoryId =
    existingCategories.find(
      (category) => category.userId === null && category.masterCategoryId === null && category.name === 'Other'
    )?._id ?? null
  let refiledCategoryRefs = 0
  // A category the file names but does not carry (a co-member's private category in a workspace
  // backup) is filed under "Other"; only an id shaped like a real one qualifies.
  const mapCategoryOrOther = (value: unknown): string => {
    try {
      return mapRequiredId(value)
    } catch (error) {
      if (otherCategoryId && OBJECT_ID_PATTERN.test(String(value ?? ''))) {
        refiledCategoryRefs += 1
        return otherCategoryId
      }
      throw error
    }
  }
  const mapIdArray = (values: unknown): string[] => {
    if (!Array.isArray(values)) return []
    return values.map((value) => mapOptionalId(value)).filter((value): value is string => value != null)
  }

  const transactionsBySourceId = new Map(backup.transactions.map((record) => [asString(record.id), record]))
  const positionBySourceId = new Map(backup.transactions.map((record, index) => [asString(record.id), index]))
  const splitLinesByParent = new Map<string, Record<string, unknown>[]>()
  for (const record of backup.transactions) {
    if (!record.splitTransactionId) continue
    const parentSourceId = asString(record.splitTransactionId)
    if (!transactionsBySourceId.has(parentSourceId)) throw new Error(BROKEN_REFERENCE_MESSAGE)
    splitLinesByParent.set(parentSourceId, [...(splitLinesByParent.get(parentSourceId) ?? []), record])
  }
  for (const record of backup.transactions) {
    if (record.type !== 'transfer') continue
    const pair = record.transferPairId ? transactionsBySourceId.get(asString(record.transferPairId)) : undefined
    if (!pair || asString(pair.transferPairId) !== asString(record.id)) throw new Error(BROKEN_REFERENCE_MESSAGE)
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
    // The local engine holds balances in major units, so a server account stored in minor units
    // (`balanceUnit: 'minor'`) is converted, as `serializeAccountDocForWire` does for sync. The
    // balance is recomputed from the restored ledger below.
    const restoredAccountIds: string[] = []
    for (const record of backup.accounts) {
      const sourceId = asString(record.id)
      const newId = generateLocalObjectId()
      const openingBalance = asNumber(record.openingBalance, 0)
      const openingBalanceMajor = record.balanceUnit === 'minor' ? fromMinorUnits(openingBalance) : openingBalance
      const doc: LocalAccount = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        workspaceId: options.targetWorkspaceId,
        name: asString(record.name),
        type: record.type as LocalAccount['type'],
        currency: asString(record.currency),
        openingBalance: openingBalanceMajor,
        openingBalanceDate:
          typeof record.openingBalanceDate === 'string' ? record.openingBalanceDate : null,
        currentBalance: openingBalanceMajor,
        isArchived: asBoolean(record.isArchived, false),
      }
      await accountsRepo.create(tx, doc)
      idMap.set(sourceId, newId)
      restoredAccountIds.push(newId)
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
        categoryId: mapCategoryOrOther(record.categoryId),
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

    // Transactions. The server only accepts a transfer as one grouped `transaction.transfer` op and
    // a split as one create carrying `splits` (see `domain/transfers.ts` / `domain/splits.ts`), so
    // those rows are written locally without their own ops and queued as a single grouped op each.
    // Rows get strictly increasing `createdAt` stamps: the local engine reads a transfer leg's
    // direction from the stored role, or from creation order for a row without one.
    const baseMs = Date.now()
    let tick = 0
    const stamp = () => new Date(baseMs + tick++).toISOString()
    const legTime = (record: Record<string, unknown>): number => {
      const parsed = Date.parse(String(record.createdAt ?? ''))
      return Number.isNaN(parsed) ? 0 : parsed
    }

    const buildTransactionDoc = (record: Record<string, unknown>, id: string): LocalTransactionRecord => {
      const createdAt = stamp()
      return {
        _id: id,
        updatedAt: createdAt,
        createdAt,
        userId: options.userId,
        workspaceId: options.targetWorkspaceId,
        accountId: mapRequiredId(record.accountId),
        categoryId: mapCategoryOrOther(record.categoryId),
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
        splitTransactionId: null,
        transferPairId: null,
      }
    }

    const handled = new Set<string>()
    for (const record of backup.transactions) {
      const sourceId = asString(record.id)
      if (handled.has(sourceId) || record.splitTransactionId) continue

      if (record.type === 'transfer') {
        const pairSourceId = asString(record.transferPairId)
        const pair = transactionsBySourceId.get(pairSourceId) as Record<string, unknown>
        const timeDelta = legTime(record) - legTime(pair)
        const recordIsOutbound = isTransferRole(record.transferRole)
          ? record.transferRole === 'out'
          : isTransferRole(pair.transferRole)
            ? pair.transferRole === 'in'
            : timeDelta !== 0
              ? timeDelta < 0
              : (positionBySourceId.get(sourceId) ?? 0) < (positionBySourceId.get(pairSourceId) ?? 0)
        const outboundRecord = recordIsOutbound ? record : pair
        const inboundRecord = recordIsOutbound ? pair : record

        const outboundId = generateLocalObjectId()
        const inboundId = generateLocalObjectId()
        const outbound: LocalTransactionRecord = {
          ...buildTransactionDoc(outboundRecord, outboundId),
          transferPairId: inboundId,
          transferRole: 'out',
        }
        const inbound: LocalTransactionRecord = {
          ...buildTransactionDoc(inboundRecord, inboundId),
          transferPairId: outboundId,
          transferRole: 'in',
        }
        await transactionsRepo.createLocalOnly(tx, outbound)
        await transactionsRepo.createLocalOnly(tx, inbound)
        await enqueueGroupedTransactionCreate(tx, outboundId, {
          intent: 'transaction.transfer',
          _id: outboundId,
          pairId: inboundId,
          amount: outbound.amount,
          date: outbound.date,
          fromAccountId: outbound.accountId,
          toAccountId: inbound.accountId,
          title: outbound.title,
          description: outbound.description,
          status: outbound.status,
          workspaceId: options.targetWorkspaceId,
        })
        idMap.set(asString(outboundRecord.id), outboundId)
        idMap.set(asString(inboundRecord.id), inboundId)
        handled.add(sourceId)
        handled.add(pairSourceId)
        created.transactions += 2
        continue
      }

      const lines = splitLinesByParent.get(sourceId)
      if (lines) {
        const parentId = generateLocalObjectId()
        const parent: LocalTransactionRecord = { ...buildTransactionDoc(record, parentId), hasSplitChildren: true }
        const children = lines.map((line) => {
          const childId = generateLocalObjectId()
          idMap.set(asString(line.id), childId)
          return { ...buildTransactionDoc(line, childId), splitTransactionId: parentId }
        })
        parent.categoryId = children[0].categoryId
        await transactionsRepo.createLocalOnly(tx, parent)
        for (const child of children) {
          await transactionsRepo.createLocalOnly(tx, child)
        }
        await enqueueGroupedTransactionCreate(tx, parentId, {
          _id: parentId,
          type: parent.type,
          status: parent.status,
          title: parent.title,
          amount: parent.amount,
          date: parent.date,
          accountId: parent.accountId,
          description: parent.description,
          paymentMethod: parent.paymentMethod,
          tags: parent.tags,
          workspaceId: options.targetWorkspaceId,
          splits: children.map((child) => ({ _id: child._id, categoryId: child.categoryId, amount: child.amount })),
        })
        idMap.set(sourceId, parentId)
        created.transactions += 1 + children.length
        continue
      }

      const newId = generateLocalObjectId()
      const doc = buildTransactionDoc(record, newId)
      if (record.recurringPaymentId) {
        // Non-fatal: recurring draft generation is server-authoritative (Sprint 13.9), so this link
        // is best-effort fidelity for a cross-restore from a server export, not load-bearing for any
        // local computation today.
        try {
          doc.recurringPaymentId = mapOptionalId(record.recurringPaymentId)
        } catch {
          doc.recurringPaymentId = null
        }
      }
      await transactionsRepo.create(tx, doc)
      idMap.set(sourceId, newId)
      created.transactions += 1
    }

    for (const accountId of restoredAccountIds) {
      await persistLocalAccountBalance(tx, accountId)
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
    ...(refiledCategoryRefs > 0
      ? {
          warnings: [
            `${refiledCategoryRefs} transaction(s) and recurring rule(s) used categories that are not in this backup and were filed under Other.`,
          ],
        }
      : {}),
  }
}
