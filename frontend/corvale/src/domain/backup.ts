import type { LocalDb } from '@platform/db/LocalDb'
import { Repository, enqueueGroupedTransactionCreate } from '@platform/db/repositories/Repository'
import { generateLocalObjectId } from '@platform/db/generateLocalId'
import { fromMinorUnits } from '@shared/money'
import { isTransferRole } from '@shared/transferDirection'
import { BackupValidationError, reconcileGoal, validateBackupRecords } from '@shared/backupValidation'
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

/** Mirrors the server's per-section record cap (`BACKUP_MAX_RECORDS_PER_COLLECTION`, SEC-50). */
export const LOCAL_BACKUP_MAX_RECORDS_PER_COLLECTION = 100_000

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
interface LocalAccountRecord extends LocalAccount {
  isDefault?: boolean
  interestRate?: number
  minimumPayment?: number
}
interface LocalTransactionRecord extends LocalTransaction {
  currency?: string
  recurringPaymentId?: string | null
  receiptIds?: string[]
}

const accountsRepo = new Repository<LocalAccountRecord>('accounts')
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
    const section = backup[key]
    if (!Array.isArray(section)) {
      throw new Error('Backup file is not a valid Corvale backup')
    }
    if (section.length > LOCAL_BACKUP_MAX_RECORDS_PER_COLLECTION) {
      throw new Error('Backup contains too many records to restore')
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

  try {
    validateBackupRecords(backup)
  } catch (error) {
    if (!(error instanceof BackupValidationError)) throw error
    errors.push(error.message)
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

  const validated = validateBackupRecords(backup)
  const created = emptyCounts()

  const existingCategories = await categoriesRepo.list(db)
  const masterCategoryIds = new Set(
    existingCategories.filter((category) => category.userId === null && category.masterCategoryId === null).map((c) => c._id)
  )

  // One map per kind of record, so a reference can only ever resolve to a row of the kind it names:
  // a crafted file cannot aim a transaction's account at a budget, or a rule's category at an account.
  const maps = {
    categories: new Map<string, string>([...masterCategoryIds].map((id) => [id, id])),
    tags: new Map<string, string>(),
    accounts: new Map<string, string>(),
    budgets: new Map<string, string>(),
    goals: new Map<string, string>(),
    recurring: new Map<string, string>(),
    rules: new Map<string, string>(),
    templates: new Map<string, string>(),
    transactions: new Map<string, string>(),
  }

  const resolve = (map: Map<string, string>, value: unknown): string => {
    const mapped = map.get(String(value ?? ''))
    if (!mapped) throw new Error(BROKEN_REFERENCE_MESSAGE)
    return mapped
  }
  const resolveOptional = (map: Map<string, string>, value: unknown): string | null =>
    value == null || value === '' ? null : resolve(map, value)

  const otherCategoryId =
    existingCategories.find(
      (category) => category.userId === null && category.masterCategoryId === null && category.name === 'Other'
    )?._id ?? null
  let refiledCategoryRefs = 0
  let demotedDefaults = 0
  let recalculatedGoals = 0
  // A category the file names but does not carry (a co-member's private category in a workspace
  // backup) is filed under "Other"; only an id shaped like a real one qualifies.
  const mapCategoryOrOther = (value: unknown): string => {
    const mapped = maps.categories.get(String(value ?? ''))
    if (mapped) return mapped
    if (otherCategoryId && OBJECT_ID_PATTERN.test(String(value ?? ''))) {
      refiledCategoryRefs += 1
      return otherCategoryId
    }
    throw new Error(BROKEN_REFERENCE_MESSAGE)
  }
  const resolveAll = (map: Map<string, string>, values: unknown): string[] =>
    Array.isArray(values) ? values.map((value) => resolve(map, value)) : []

  const transactionsBySourceId = new Map(backup.transactions.map((record) => [asString(record.id), record]))
  const fieldsBySourceId = new Map(backup.transactions.map((record, index) => [asString(record.id), validated.transactions[index]]))
  const positionBySourceId = new Map(backup.transactions.map((record, index) => [asString(record.id), index]))
  const splitLinesByParent = new Map<string, Record<string, unknown>[]>()
  for (const record of backup.transactions) {
    if (!record.splitTransactionId) continue
    const parentSourceId = asString(record.splitTransactionId)
    splitLinesByParent.set(parentSourceId, [...(splitLinesByParent.get(parentSourceId) ?? []), record])
  }

  await db.transaction(async (tx) => {
    const nowIso = () => new Date().toISOString()
    const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null)

    // Categories: pass-through for shared master categories, fresh row for custom ones. A custom
    // category's parent must be a shared master, never another restored row.
    for (const [index, record] of backup.categories.entries()) {
      const sourceId = asString(record.id)
      if (masterCategoryIds.has(sourceId)) continue
      const fields = validated.categories[index]
      const newId = generateLocalObjectId()
      const parentId = resolveOptional(maps.categories, record.masterCategoryId)
      if (parentId !== null && !masterCategoryIds.has(parentId)) throw new Error(BROKEN_REFERENCE_MESSAGE)
      const doc: LocalCategoryRecord = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        masterCategoryId: parentId,
        name: fields.name,
        color: fields.color,
        icon: fields.icon,
        sortOrder: fields.sortOrder,
        isArchived: fields.isArchived,
      }
      await categoriesRepo.create(tx, doc)
      maps.categories.set(sourceId, newId)
      created.categories += 1
    }

    // Tags: dedup by name against what's already local, matching the server's `Tag.findOne` check.
    const existingTags = await tagsRepo.list(tx)
    for (const [index, record] of backup.tags.entries()) {
      const sourceId = asString(record.id)
      const fields = validated.tags[index]
      const existing = existingTags.find((tag) => tag.name === fields.name)
      if (existing) {
        maps.tags.set(sourceId, existing._id)
        continue
      }
      const newId = generateLocalObjectId()
      const doc: LocalTag = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        name: fields.name,
        color: fields.color,
      }
      await tagsRepo.create(tx, doc)
      maps.tags.set(sourceId, newId)
      existingTags.push(doc)
      created.tags += 1
    }

    // Accounts (never remap workspaceId - always the current restore target, mirroring the backend).
    // The local engine holds balances in major units, so a server account stored in minor units
    // (`balanceUnit: 'minor'`) is converted, as `serializeAccountDocForWire` does for sync. The
    // balance is recomputed from the restored ledger below.
    const restoredAccountIds: string[] = []
    let defaultAvailable =
      !options.targetWorkspaceId &&
      !(await accountsRepo.list(tx)).some((account) => account.isDefault && !account.isArchived && !account.workspaceId)
    for (const [index, record] of backup.accounts.entries()) {
      const fields = validated.accounts[index]
      const newId = generateLocalObjectId()
      const openingBalanceMajor =
        fields.balanceUnit === 'minor' ? fromMinorUnits(fields.openingBalance) : fields.openingBalance
      let isDefault = false
      if (fields.wantsDefault && !fields.isArchived && !options.targetWorkspaceId) {
        if (defaultAvailable) {
          isDefault = true
          defaultAvailable = false
        } else {
          demotedDefaults += 1
        }
      }
      const doc: LocalAccountRecord = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        workspaceId: options.targetWorkspaceId,
        name: fields.name,
        type: fields.type,
        currency: fields.currency,
        openingBalance: openingBalanceMajor,
        openingBalanceDate: iso(fields.openingBalanceDate),
        currentBalance: openingBalanceMajor,
        isArchived: fields.isArchived,
        isDefault,
        ...(fields.interestRate !== undefined ? { interestRate: fields.interestRate } : {}),
        ...(fields.minimumPayment !== undefined ? { minimumPayment: fields.minimumPayment } : {}),
      }
      await accountsRepo.create(tx, doc)
      maps.accounts.set(asString(record.id), newId)
      restoredAccountIds.push(newId)
      created.accounts += 1
    }

    // Budgets
    for (const [index, record] of backup.budgets.entries()) {
      const fields = validated.budgets[index]
      const newId = generateLocalObjectId()
      const doc: LocalBudgetRecord = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        workspaceId: options.targetWorkspaceId,
        name: fields.name,
        periodType: fields.periodType,
        periodStart: fields.periodStart.toISOString(),
        periodEnd: fields.periodEnd.toISOString(),
        categoryId: resolveOptional(maps.categories, record.categoryId),
        amount: fields.amount,
        currency: fields.currency,
        rollover: fields.rollover,
        accountIds: resolveAll(maps.accounts, record.accountIds),
        isArchived: fields.isArchived,
      }
      await budgetsRepo.create(tx, doc)
      maps.budgets.set(asString(record.id), newId)
      created.budgets += 1
    }

    // Savings goals: the saved amount is the sum of the contributions, never the file's figure.
    for (const [index, record] of backup.savingsGoals.entries()) {
      const { declaredAmount, ...fields } = validated.goals[index]
      const currentAmount = validated.contributedByGoal.get(asString(record.id)) ?? 0
      if (currentAmount !== declaredAmount) recalculatedGoals += 1
      const { status, completedAt } = reconcileGoal(fields, currentAmount)
      const newId = generateLocalObjectId()
      const auto = fields.autoContribution as Record<string, unknown>
      const doc: LocalSavingsGoalRecord = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        workspaceId: options.targetWorkspaceId,
        name: fields.name,
        targetAmount: fields.targetAmount,
        currentAmount,
        currency: fields.currency,
        targetDate: iso(fields.targetDate),
        status,
        accountId: resolveOptional(maps.accounts, record.accountId),
        autoContribution: {
          enabled: false,
          amount: 0,
          interval: 'monthly',
          ...auto,
          ...(auto.lastContributedAt instanceof Date ? { lastContributedAt: auto.lastContributedAt.toISOString() } : {}),
        } as LocalSavingsGoal['autoContribution'],
        completedAt: iso(completedAt),
      }
      await goalsRepo.create(tx, doc)
      maps.goals.set(asString(record.id), newId)
      created.savingsGoals += 1
    }

    // Recurring rules
    for (const [index, record] of backup.recurringRules.entries()) {
      const fields = validated.recurringRules[index]
      const newId = generateLocalObjectId()
      const doc: LocalRecurringRule = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        workspaceId: options.targetWorkspaceId,
        title: fields.title,
        type: fields.type,
        amount: fields.amount,
        currency: fields.currency,
        accountId: resolve(maps.accounts, record.accountId),
        categoryId: mapCategoryOrOther(record.categoryId),
        interval: fields.interval,
        customIntervalDays: fields.customIntervalDays,
        nextDueDate: fields.nextDueDate.toISOString(),
        description: fields.description,
        paymentMethod: fields.paymentMethod,
        tags: fields.tags,
        isActive: fields.isActive,
        isArchived: fields.isArchived,
        isCancelled: fields.isCancelled,
      }
      await recurringRepo.create(tx, doc)
      maps.recurring.set(asString(record.id), newId)
      created.recurringRules += 1
    }

    // Categorization rules
    for (const [index, record] of backup.categorizationRules.entries()) {
      const fields = validated.categorizationRules[index]
      const newId = generateLocalObjectId()
      const doc: LocalCategorizationRule = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        name: fields.name,
        matchType: fields.matchType,
        matchValue: fields.matchValue,
        amountMin: fields.amountMin,
        amountMax: fields.amountMax,
        accountId: record.accountId ? resolve(maps.accounts, record.accountId) : undefined,
        categoryId: resolve(maps.categories, record.categoryId),
        tags: fields.tags,
        priority: fields.priority,
        isActive: fields.isActive,
      }
      await rulesRepo.create(tx, doc)
      maps.rules.set(asString(record.id), newId)
      created.categorizationRules += 1
    }

    // Transaction templates
    for (const [index, record] of backup.transactionTemplates.entries()) {
      const fields = validated.templates[index]
      const newId = generateLocalObjectId()
      const doc: LocalTransactionTemplate = {
        _id: newId,
        updatedAt: nowIso(),
        userId: options.userId,
        name: fields.name,
        type: fields.type,
        amount: fields.amount,
        accountId: resolve(maps.accounts, record.accountId),
        categoryId: resolve(maps.categories, record.categoryId),
        tags: fields.tags,
        description: fields.description,
      }
      await templatesRepo.create(tx, doc)
      maps.templates.set(asString(record.id), newId)
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
      const fields = fieldsBySourceId.get(asString(record.id))!
      return {
        _id: id,
        updatedAt: createdAt,
        createdAt,
        userId: options.userId,
        workspaceId: options.targetWorkspaceId,
        accountId: resolve(maps.accounts, record.accountId),
        categoryId: mapCategoryOrOther(record.categoryId),
        type: fields.type,
        status: fields.status,
        amount: fields.amount,
        currency: fields.currency,
        title: fields.title,
        description: fields.description,
        date: fields.date.toISOString(),
        clearedStatus: fields.clearedStatus,
        reconciledAt: iso(fields.reconciledAt),
        externalId: fields.externalId,
        tags: fields.tags,
        paymentMethod: fields.paymentMethod,
        source: fields.source,
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
        maps.transactions.set(asString(outboundRecord.id), outboundId)
        maps.transactions.set(asString(inboundRecord.id), inboundId)
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
          maps.transactions.set(asString(line.id), childId)
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
        maps.transactions.set(sourceId, parentId)
        created.transactions += 1 + children.length
        continue
      }

      const newId = generateLocalObjectId()
      const doc = buildTransactionDoc(record, newId)
      // Recurring draft generation is server-authoritative (Sprint 13.9); the link is best-effort
      // fidelity and, like every reference here, can only point at a restored recurring rule.
      doc.recurringPaymentId = record.recurringPaymentId ? (maps.recurring.get(asString(record.recurringPaymentId)) ?? null) : null
      await transactionsRepo.create(tx, doc)
      maps.transactions.set(sourceId, newId)
      created.transactions += 1
    }

    for (const accountId of restoredAccountIds) {
      await persistLocalAccountBalance(tx, accountId)
    }

    // Savings goal contributions
    for (const [index, record] of backup.savingsGoalContributions.entries()) {
      const fields = validated.contributions[index]
      const doc: LocalSavingsGoalContributionRecord = {
        _id: generateLocalObjectId(),
        updatedAt: nowIso(),
        userId: options.userId,
        goalId: resolve(maps.goals, record.goalId),
        amount: fields.amount,
        type: fields.type,
        note: fields.note,
        contributedAt: fields.contributedAt.toISOString(),
      }
      await contributionsRepo.create(tx, doc)
      created.savingsGoalContributions += 1
    }
  })

  const warnings: string[] = []
  if (refiledCategoryRefs > 0) {
    warnings.push(
      `${refiledCategoryRefs} transaction(s) and recurring rule(s) used categories that are not in this backup and were filed under Other.`
    )
  }
  if (recalculatedGoals > 0) {
    warnings.push(
      `${recalculatedGoals} savings goal(s) had a saved amount that did not match their contributions and were recalculated.`
    )
  }
  if (demotedDefaults > 0) {
    warnings.push(
      'The default account in this backup was restored as a regular account because a default account already exists.'
    )
  }

  const idMapping: Record<string, string> = {}
  for (const map of Object.values(maps)) {
    for (const [source, target] of map) idMapping[source] = target
  }

  return {
    created,
    idMapping,
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
