import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Types } from 'mongoose'
import { PassThrough } from 'stream'

// CommonJS interop for ESM-only packages. archiver v8 dropped the callable `archiver('zip', …)`
// factory and exports named archive classes instead, so construct `ZipArchive` directly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ZipArchive } = require('archiver') as {
    ZipArchive: new (options?: { zlib?: { level?: number } }) => {
        pipe: (dest: PassThrough) => void
        append: (source: string | Buffer, opts: { name: string }) => void
        file: (source: string, opts: { name: string }) => void
        finalize: () => Promise<void>
    }
}
interface ZipEntry {
    getData: () => Buffer
    isDirectory: boolean
    entryName: string
    header: { size: number; compressedSize: number }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip') as new (buffer: Buffer) => {
    getEntry: (name: string) => ZipEntry | null
    getEntries: () => ZipEntry[]
}

import Account from '../models/Account'
import Budget from '../models/Budget'
import CategorizationRule from '../models/CategorizationRule'
import Category from '../models/Category'
import Receipt from '../models/Receipt'
import RecurringRule from '../models/RecurringRule'
import SavingsGoal from '../models/SavingsGoal'
import SavingsGoalContribution from '../models/SavingsGoalContribution'
import Tag from '../models/Tag'
import Transaction from '../models/Transaction'
import TransactionTemplate from '../models/TransactionTemplate'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    getReceiptObjectBuffer,
    isObjectStorageConfigured,
    putReceiptObject,
    receiptObjectKey,
} from '@infra/storage/receiptStorage'
import {
    assertValidReceiptBuffer,
    assertWithinReceiptStorageQuota,
    deleteReceiptFile,
    getReceiptFilePath,
} from './receiptUtils'
import { scanUploadedFile } from '@infra/security/virusScanService'
import { buildScopedListFilter } from '@core/access/workspace'

export const BACKUP_VERSION = 1 as const
export const BACKUP_MAX_ZIP_BYTES = 50 * 1024 * 1024

// Read fresh on every call (not cached at module load) so tests can override via process.env,
// mirroring the pattern in middleware/rateLimitMiddleware.ts's createAuthRateLimiter.
const getBackupMaxUncompressedBytes = (): number =>
    Number(process.env.BACKUP_MAX_UNCOMPRESSED_BYTES) || 200 * 1024 * 1024
const getBackupMaxZipEntries = (): number =>
    Number(process.env.BACKUP_MAX_ZIP_ENTRIES) || 10_000
const getBackupMaxCompressionRatio = (): number =>
    Number(process.env.BACKUP_MAX_COMPRESSION_RATIO) || 100
// Cap on the deserialized `corvale-backup.json`. The `.json` upload branch always checked this
// against the raw buffer; the `.zip` branch never did (SEC-50) — the embedded JSON was bounded
// only by BACKUP_MAX_UNCOMPRESSED_BYTES (200 MB, and also covering receipt bytes).
const getBackupMaxJsonBytes = (): number =>
    Number(process.env.BACKUP_MAX_JSON_BYTES) || 10 * 1024 * 1024
// Per-section record cap (SEC-50). `parseBackupPayload` checked record *shape* but never
// *count*, so a payload under the JSON-size cap could still hold ~1.5 M records driving that
// many writes in one request.
const getBackupMaxRecordsPerCollection = (): number =>
    Number(process.env.BACKUP_MAX_RECORDS_PER_COLLECTION) || 100_000

export interface BackupScope {
    workspaceId: string | null
}

export interface BackupEntityCounts {
    accounts: number
    categories: number
    tags: number
    budgets: number
    savingsGoals: number
    savingsGoalContributions: number
    recurringRules: number
    categorizationRules: number
    transactionTemplates: number
    transactions: number
    receipts: number
}

export interface CorvaleBackupPayload {
    version: typeof BACKUP_VERSION
    exportedAt: string
    scope: BackupScope
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

export interface BackupRestorePreview {
    valid: boolean
    version: number
    exportedAt: string | null
    sourceScope: BackupScope
    targetScope: BackupScope
    counts: BackupEntityCounts
    warnings: string[]
    errors: string[]
}

export interface BackupRestoreResult {
    created: BackupEntityCounts
    idMapping: Record<string, string>
}

const OBJECT_ID_ARRAY_FIELDS = new Set(['accountIds', 'receiptIds'])

const toIdString = (value: unknown): string | null => {
    if (value == null) {
        return null
    }
    if (value instanceof Types.ObjectId) {
        return value.toString()
    }
    if (typeof value === 'object' && value !== null && '_id' in value) {
        const nested = (value as { _id?: unknown })._id
        return nested instanceof Types.ObjectId ? nested.toString() : String(nested)
    }
    return String(value)
}

const serializeDoc = (doc: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = { id: toIdString(doc._id) }

    for (const [key, value] of Object.entries(doc)) {
        if (key === '_id' || key === '__v' || key === 'userId') {
            continue
        }

        if (value instanceof Types.ObjectId) {
            result[key] = value.toString()
            continue
        }

        if (value instanceof Date) {
            result[key] = value.toISOString()
            continue
        }

        if (Array.isArray(value)) {
            if (OBJECT_ID_ARRAY_FIELDS.has(key)) {
                result[key] = value.map((item) => toIdString(item))
                continue
            }
            result[key] = value
            continue
        }

        if (value && typeof value === 'object' && !(value instanceof Date)) {
            result[key] = serializeNested(value as Record<string, unknown>)
            continue
        }

        result[key] = value
    }

    return result
}

const serializeNested = (value: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value)) {
        if (nestedValue instanceof Date) {
            result[key] = nestedValue.toISOString()
        } else if (nestedValue instanceof Types.ObjectId) {
            result[key] = nestedValue.toString()
        } else {
            result[key] = nestedValue
        }
    }
    return result
}

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

export const exportUserBackup = async (
    userId: string,
    workspaceId: string | null
): Promise<CorvaleBackupPayload> => {
    const scopeFilter = buildScopedListFilter(userId, workspaceId)

    const [accounts, budgets, savingsGoals, recurringRules, transactions] = await Promise.all([
        Account.find(scopeFilter).lean(),
        Budget.find(scopeFilter).lean(),
        SavingsGoal.find(scopeFilter).lean(),
        RecurringRule.find(scopeFilter).lean(),
        Transaction.find(scopeFilter).lean(),
    ])

    const goalIds = savingsGoals.map((goal) => goal._id)
    const savingsGoalContributions =
        goalIds.length > 0
            ? await SavingsGoalContribution.find({ userId, goalId: { $in: goalIds } }).lean()
            : []

    const categoryIds = new Set<string>()
    const receiptIds = new Set<string>()

    for (const transaction of transactions) {
        categoryIds.add(transaction.categoryId.toString())
        transaction.receiptIds?.forEach((receiptId) => receiptIds.add(receiptId.toString()))
    }

    for (const budget of budgets) {
        if (budget.categoryId) {
            categoryIds.add(budget.categoryId.toString())
        }
    }

    for (const goal of savingsGoals) {
        if (goal.accountId) {
            // account already in scope
        }
    }

    for (const rule of recurringRules) {
        categoryIds.add(rule.categoryId.toString())
    }

    const [userCategories, categorizationRules, transactionTemplates, tags] = await Promise.all([
        Category.find({ userId: new Types.ObjectId(userId) }).lean(),
        CategorizationRule.find({ userId }).lean(),
        TransactionTemplate.find({ userId }).lean(),
        Tag.find({ userId }).lean(),
    ])

    for (const category of userCategories) {
        categoryIds.add(category._id.toString())
        if (category.masterCategoryId) {
            categoryIds.add(category.masterCategoryId.toString())
        }
    }

    for (const rule of categorizationRules) {
        categoryIds.add(rule.categoryId.toString())
        if (rule.accountId) {
            // accounts in scope or personal
        }
    }

    for (const template of transactionTemplates) {
        categoryIds.add(template.categoryId.toString())
    }

    const masterCategories = await Category.find({
        _id: { $in: [...categoryIds].filter(Types.ObjectId.isValid).map((id) => new Types.ObjectId(id)) },
        userId: null,
    }).lean()

    const exportedCategoryIds = new Set(userCategories.map((category) => category._id.toString()))
    masterCategories.forEach((category) => exportedCategoryIds.add(category._id.toString()))

    const exportedCategories = [
        ...userCategories.map((doc) => serializeDoc(doc as Record<string, unknown>)),
        ...masterCategories.map((doc) => serializeDoc(doc as Record<string, unknown>)),
    ]

    const exportedTags = tags.map((doc) => serializeDoc(doc as Record<string, unknown>))

    const receipts =
        receiptIds.size > 0
            ? await Receipt.find({
                  userId,
                  _id: { $in: [...receiptIds].map((id) => new Types.ObjectId(id)) },
              }).lean()
            : []

    const payload: CorvaleBackupPayload = {
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        scope: { workspaceId },
        counts: emptyCounts(),
        accounts: accounts.map((doc) => serializeDoc(doc as Record<string, unknown>)),
        categories: exportedCategories,
        tags: exportedTags,
        budgets: budgets.map((doc) => serializeDoc(doc as Record<string, unknown>)),
        savingsGoals: savingsGoals.map((doc) => serializeDoc(doc as Record<string, unknown>)),
        savingsGoalContributions: savingsGoalContributions.map((doc) =>
            serializeDoc(doc as Record<string, unknown>)
        ),
        recurringRules: recurringRules.map((doc) => serializeDoc(doc as Record<string, unknown>)),
        categorizationRules: categorizationRules.map((doc) => serializeDoc(doc as Record<string, unknown>)),
        transactionTemplates: transactionTemplates.map((doc) => serializeDoc(doc as Record<string, unknown>)),
        transactions: transactions.map((doc) => serializeDoc(doc as Record<string, unknown>)),
        receipts: receipts.map((doc) => serializeDoc(doc as Record<string, unknown>)),
    }

    payload.counts = buildCounts(payload)
    return payload
}

export const parseBackupPayload = (raw: unknown): CorvaleBackupPayload => {
    if (!raw || typeof raw !== 'object') {
        throw new CustomError(ERROR_MESSAGES.BACKUP.INVALID_FORMAT, 400)
    }

    const backup = raw as Partial<CorvaleBackupPayload>

    if (backup.version !== BACKUP_VERSION) {
        throw new CustomError(ERROR_MESSAGES.BACKUP.UNSUPPORTED_VERSION, 400)
    }

    const requiredArrays = [
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

    const maxRecordsPerCollection = getBackupMaxRecordsPerCollection()

    for (const key of requiredArrays) {
        const section = backup[key]
        if (!Array.isArray(section)) {
            throw new CustomError(ERROR_MESSAGES.BACKUP.INVALID_FORMAT, 400)
        }

        if (section.length > maxRecordsPerCollection) {
            throw new CustomError(ERROR_MESSAGES.BACKUP.TOO_MANY_RECORDS, 400)
        }

        // Per-record shape check — previously the payload was trusted wholesale past the
        // "is it an array" gate (SEC-28). Every record must be a plain object carrying an id;
        // the restore loop stringifies `record.id` and would otherwise map `"undefined"`.
        for (const record of section) {
            if (!isPlainRecord(record) || record.id == null || record.id === '') {
                throw new CustomError(ERROR_MESSAGES.BACKUP.INVALID_FORMAT, 400)
            }
        }
    }

    for (const receipt of backup.receipts as Record<string, unknown>[]) {
        validateReceiptRecord(receipt)
    }

    return backup as CorvaleBackupPayload
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Restore no longer trusts a receipt record's `mimeType`/`size` — both are re-derived from the
 * actual bytes (SEC-28) — but a structurally broken record should still be rejected up front
 * rather than blowing up mid-restore. `storedFilename` is the key used to find the file inside
 * the ZIP, so it must be a usable string.
 */
const validateReceiptRecord = (receipt: Record<string, unknown>): void => {
    if (
        typeof receipt.originalFilename !== 'string' ||
        receipt.originalFilename.trim() === '' ||
        typeof receipt.storedFilename !== 'string' ||
        receipt.storedFilename.trim() === ''
    ) {
        throw new CustomError(ERROR_MESSAGES.BACKUP.INVALID_FORMAT, 400)
    }

    // `mimeType` and `size` are only shape-checked here, not enforced — restore ignores both
    // and re-derives them from the actual bytes (SEC-28). A pre-S14 backup may carry a
    // declared type outside today's allowlist, and that must still restore.
    if (receipt.mimeType !== undefined && typeof receipt.mimeType !== 'string') {
        throw new CustomError(ERROR_MESSAGES.BACKUP.INVALID_FORMAT, 400)
    }

    if (
        receipt.size !== undefined &&
        (typeof receipt.size !== 'number' ||
            !Number.isFinite(receipt.size) ||
            receipt.size < 0)
    ) {
        throw new CustomError(ERROR_MESSAGES.BACKUP.INVALID_FORMAT, 400)
    }
}

export const previewBackupRestore = (
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
            'Receipt metadata is included. Binary receipt files are only restored from ZIP backups.'
        )
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

const mapOptionalId = (
    idMap: Map<string, string>,
    value: unknown,
    masterCategoryIds: Set<string>
): Types.ObjectId | null | undefined => {
    if (value == null || value === '') {
        return null
    }

    const id = String(value)
    if (masterCategoryIds.has(id)) {
        return new Types.ObjectId(id)
    }

    const mapped = idMap.get(id)
    if (!mapped) {
        throw new CustomError(ERROR_MESSAGES.BACKUP.BROKEN_REFERENCE, 400)
    }
    return new Types.ObjectId(mapped)
}

const mapRequiredId = (idMap: Map<string, string>, value: unknown): Types.ObjectId => {
    const mapped = mapOptionalId(idMap, value, new Set())
    if (!mapped) {
        throw new CustomError(ERROR_MESSAGES.BACKUP.BROKEN_REFERENCE, 400)
    }
    return mapped
}

const mapIdArray = (idMap: Map<string, string>, values: unknown): Types.ObjectId[] => {
    if (!Array.isArray(values)) {
        return []
    }
    return values
        .map((value) => mapOptionalId(idMap, value, new Set()))
        .filter((value): value is Types.ObjectId => value != null)
}

const parseDate = (value: unknown): Date => {
    if (value instanceof Date) {
        return value
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value)
        if (!isNaN(parsed.getTime())) {
            return parsed
        }
    }
    throw new CustomError(ERROR_MESSAGES.BACKUP.INVALID_FORMAT, 400)
}

const loadMasterCategoryIds = async (): Promise<Set<string>> => {
    const masters = await Category.find({ userId: null, masterCategoryId: null }).select('_id').lean()
    return new Set(masters.map((category) => category._id.toString()))
}

export const restoreUserBackup = async (
    userId: string,
    backup: CorvaleBackupPayload,
    targetWorkspaceId: string | null,
    receiptFiles?: Map<string, Buffer>
): Promise<BackupRestoreResult> => {
    const preview = previewBackupRestore(backup, targetWorkspaceId)
    if (!preview.valid) {
        throw new CustomError(preview.errors.join(' '), 400)
    }

    const idMap = new Map<string, string>()
    // SEC-51: account and category references are resolved through their own maps, which only
    // ever hold ids created by this restore (plus the shared master categories). A crafted
    // backup can no longer install an identity mapping (e.g. via a budget whose `id` is a
    // victim's account ObjectId) that a later record resolves as its `accountId`/`categoryId`.
    const accountIdMap = new Map<string, string>()
    const categoryIdMap = new Map<string, string>()
    const masterCategoryIds = await loadMasterCategoryIds()
    for (const masterId of masterCategoryIds) {
        categoryIdMap.set(masterId, masterId)
    }
    const created = emptyCounts()

    const userObjectId = new Types.ObjectId(userId)
    const workspaceObjectId = targetWorkspaceId ? new Types.ObjectId(targetWorkspaceId) : null

    for (const record of backup.categories) {
        const sourceId = String(record.id)
        if (masterCategoryIds.has(sourceId)) {
            categoryIdMap.set(sourceId, sourceId)
            continue
        }

        const createdCategory = await Category.create({
            userId: userObjectId,
            masterCategoryId: mapOptionalId(categoryIdMap, record.masterCategoryId, masterCategoryIds),
            name: record.name,
            icon: record.icon,
            color: record.color,
            isDefault: false,
            isArchived: record.isArchived ?? false,
            sortOrder: record.sortOrder ?? 0,
        })
        categoryIdMap.set(sourceId, createdCategory._id.toString())
        created.categories += 1
    }

    for (const record of backup.tags) {
        const sourceId = String(record.id)
        const existing = await Tag.findOne({ userId, name: record.name })
        if (existing) {
            idMap.set(sourceId, existing._id.toString())
            continue
        }

        const createdTag = await Tag.create({
            userId: userObjectId,
            name: record.name,
            color: record.color,
        })
        idMap.set(sourceId, createdTag._id.toString())
        created.tags += 1
    }

    for (const record of backup.accounts) {
        const sourceId = String(record.id)
        const createdAccount = await Account.create({
            userId: userObjectId,
            workspaceId: workspaceObjectId,
            name: record.name,
            type: record.type,
            currency: record.currency,
            // balanceUnit round-trips whatever unit the exported account was actually stored
            // in (Sprint C5) — a backup predating that field has none, so it correctly
            // defaults to 'major', matching what a pre-migration account's raw numbers mean.
            balanceUnit: record.balanceUnit === 'minor' ? 'minor' : 'major',
            openingBalance: record.openingBalance ?? 0,
            openingBalanceDate: record.openingBalanceDate
                ? parseDate(record.openingBalanceDate)
                : null,
            currentBalance: record.currentBalance ?? record.openingBalance ?? 0,
            isDefault: false,
            isArchived: record.isArchived ?? false,
        })
        accountIdMap.set(sourceId, createdAccount._id.toString())
        created.accounts += 1
    }

    for (const record of backup.budgets) {
        const sourceId = String(record.id)
        const createdBudget = await Budget.create({
            userId: userObjectId,
            workspaceId: workspaceObjectId,
            name: record.name,
            periodType: record.periodType,
            periodStart: parseDate(record.periodStart),
            periodEnd: parseDate(record.periodEnd),
            categoryId: mapOptionalId(categoryIdMap, record.categoryId, masterCategoryIds),
            amount: record.amount,
            currency: record.currency,
            rollover: record.rollover ?? false,
            accountIds: mapIdArray(accountIdMap, record.accountIds),
            isArchived: record.isArchived ?? false,
        })
        idMap.set(sourceId, createdBudget._id.toString())
        created.budgets += 1
    }

    for (const record of backup.savingsGoals) {
        const sourceId = String(record.id)
        const createdGoal = await SavingsGoal.create({
            userId: userObjectId,
            workspaceId: workspaceObjectId,
            name: record.name,
            targetAmount: record.targetAmount,
            currentAmount: record.currentAmount ?? 0,
            currency: record.currency,
            targetDate: record.targetDate ? parseDate(record.targetDate) : null,
            status: record.status ?? 'active',
            accountId: mapOptionalId(accountIdMap, record.accountId, new Set()),
            autoContribution: record.autoContribution ?? {},
            completedAt: record.completedAt ? parseDate(record.completedAt) : null,
        })
        idMap.set(sourceId, createdGoal._id.toString())
        created.savingsGoals += 1
    }

    for (const record of backup.recurringRules) {
        const sourceId = String(record.id)
        const createdRule = await RecurringRule.create({
            userId: userObjectId,
            workspaceId: workspaceObjectId,
            title: record.title,
            type: record.type,
            amount: record.amount,
            currency: record.currency,
            accountId: mapRequiredId(accountIdMap, record.accountId),
            categoryId: mapRequiredId(categoryIdMap, record.categoryId),
            interval: record.interval,
            customIntervalDays: record.customIntervalDays,
            nextDueDate: parseDate(record.nextDueDate),
            description: record.description,
            paymentMethod: record.paymentMethod,
            tags: record.tags ?? [],
            isActive: record.isActive ?? true,
            isArchived: record.isArchived ?? false,
        })
        idMap.set(sourceId, createdRule._id.toString())
        created.recurringRules += 1
    }

    for (const record of backup.categorizationRules) {
        const sourceId = String(record.id)
        const createdCategorizationRule = await CategorizationRule.create({
            userId: userObjectId,
            name: record.name,
            matchType: record.matchType,
            matchValue: record.matchValue,
            amountMin: record.amountMin,
            amountMax: record.amountMax,
            accountId: record.accountId
                ? mapOptionalId(accountIdMap, record.accountId, new Set())
                : undefined,
            categoryId: mapRequiredId(categoryIdMap, record.categoryId),
            tags: record.tags ?? [],
            priority: record.priority ?? 0,
            isActive: record.isActive ?? true,
        })
        idMap.set(sourceId, createdCategorizationRule._id.toString())
        created.categorizationRules += 1
    }

    for (const record of backup.transactionTemplates) {
        const sourceId = String(record.id)
        const createdTemplate = await TransactionTemplate.create({
            userId: userObjectId,
            name: record.name,
            type: record.type,
            amount: record.amount,
            accountId: mapRequiredId(accountIdMap, record.accountId),
            categoryId: mapRequiredId(categoryIdMap, record.categoryId),
            tags: record.tags ?? [],
            description: record.description,
        })
        idMap.set(sourceId, createdTemplate._id.toString())
        created.transactionTemplates += 1
    }

    for (const record of backup.receipts) {
        const sourceId = String(record.id)
        const storedFilename = String(record.storedFilename ?? '')
        const fileBuffer = receiptFiles?.get(storedFilename)

        if (!fileBuffer) {
            continue
        }

        // Restore used to write the file blind and copy `mimeType`/`size` straight from the
        // backup JSON (SEC-28), skipping every control `POST /receipts` enforces. Run the
        // same pipeline here: sniff the real bytes, allowlist the detected type, size from
        // the buffer, per-user quota, then virus-scan the written file.
        const detectedMimeType = assertValidReceiptBuffer(fileBuffer)
        const actualSize = fileBuffer.byteLength

        await assertWithinReceiptStorageQuota(userId, actualSize)

        const ext = path.extname(String(record.originalFilename ?? '')).toLowerCase()
        const safeExt = ext.length <= 10 ? ext : ''
        const newStoredFilename = `${crypto.randomUUID()}${safeExt}`

        const destPath = getReceiptFilePath(userId, newStoredFilename)
        fs.mkdirSync(path.dirname(destPath), { recursive: true })
        fs.writeFileSync(destPath, fileBuffer)

        try {
            await scanUploadedFile(destPath)
        } catch (error) {
            deleteReceiptFile(userId, newStoredFilename)
            throw error
        }

        if (isObjectStorageConfigured()) {
            await putReceiptObject(
                receiptObjectKey(userId, newStoredFilename),
                destPath,
                detectedMimeType
            )
            // Object storage is the only durable copy — the local write was staging for the
            // scan and the upload, exactly as in `uploadReceipt` (SEC-23).
            deleteReceiptFile(userId, newStoredFilename)
        }

        const createdReceipt = await Receipt.create({
            userId: userObjectId,
            originalFilename: record.originalFilename,
            storedFilename: newStoredFilename,
            mimeType: detectedMimeType,
            size: actualSize,
        })

        idMap.set(sourceId, createdReceipt._id.toString())
        created.receipts += 1
    }

    const deferredTransactionUpdates: {
        sourceId: string
        transferPairId?: unknown
        splitTransactionId?: unknown
        recurringPaymentId?: unknown
        receiptIds?: unknown
    }[] = []

    // SEC-50: build every transaction doc first (resolving refs, which can still throw a broken-
    // reference 400), then write the batch in one `insertMany` rather than an awaited create per
    // record. Ids are pre-generated so the deferred link-up pass can resolve them.
    const transactionDocs: Record<string, unknown>[] = []
    for (const record of backup.transactions) {
        const sourceId = String(record.id)
        const newId = new Types.ObjectId()
        idMap.set(sourceId, newId.toString())

        transactionDocs.push({
            _id: newId,
            userId: userObjectId,
            workspaceId: workspaceObjectId,
            accountId: mapRequiredId(accountIdMap, record.accountId),
            categoryId: mapRequiredId(categoryIdMap, record.categoryId),
            type: record.type,
            status: record.status ?? 'posted',
            amount: record.amount,
            currency: record.currency,
            title: record.title,
            description: record.description,
            date: parseDate(record.date),
            source: record.source,
            paymentMethod: record.paymentMethod,
            tags: record.tags ?? [],
        })

        if (
            record.transferPairId ||
            record.splitTransactionId ||
            record.recurringPaymentId ||
            (Array.isArray(record.receiptIds) && record.receiptIds.length > 0)
        ) {
            deferredTransactionUpdates.push({
                sourceId,
                transferPairId: record.transferPairId,
                splitTransactionId: record.splitTransactionId,
                recurringPaymentId: record.recurringPaymentId,
                receiptIds: record.receiptIds,
            })
        }
    }

    if (transactionDocs.length > 0) {
        await Transaction.insertMany(transactionDocs)
    }
    created.transactions = transactionDocs.length

    const deferredOps: {
        updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> }
    }[] = []
    for (const update of deferredTransactionUpdates) {
        const newId = idMap.get(update.sourceId)
        if (!newId) {
            continue
        }

        const patch: Record<string, unknown> = {}

        if (update.transferPairId) {
            patch.transferPairId = mapOptionalId(idMap, update.transferPairId, new Set())
        }
        if (update.splitTransactionId) {
            patch.splitTransactionId = mapOptionalId(idMap, update.splitTransactionId, new Set())
        }
        if (update.recurringPaymentId) {
            patch.recurringPaymentId = mapOptionalId(idMap, update.recurringPaymentId, new Set())
        }
        if (update.receiptIds) {
            patch.receiptIds = mapIdArray(idMap, update.receiptIds)
        }

        if (Object.keys(patch).length > 0) {
            deferredOps.push({ updateOne: { filter: { _id: newId }, update: { $set: patch } } })
        }
    }
    if (deferredOps.length > 0) {
        await Transaction.bulkWrite(deferredOps)
    }

    const contributionDocs = backup.savingsGoalContributions.map((record) => ({
        userId: userObjectId,
        goalId: mapRequiredId(idMap, record.goalId),
        amount: record.amount,
        type: record.type,
        note: record.note,
        contributedAt: parseDate(record.contributedAt),
    }))
    if (contributionDocs.length > 0) {
        await SavingsGoalContribution.insertMany(contributionDocs)
    }
    created.savingsGoalContributions = contributionDocs.length

    return {
        created,
        idMapping: Object.fromEntries([
            ...accountIdMap.entries(),
            ...categoryIdMap.entries(),
            ...idMap.entries(),
        ]),
    }
}

export const createBackupZipStream = async (
    userId: string,
    payload: CorvaleBackupPayload
): Promise<{ stream: PassThrough; filename: string }> => {
    const stream = new PassThrough()
    const archive = new ZipArchive({ zlib: { level: 9 } })
    archive.pipe(stream)

    archive.append(JSON.stringify(payload, null, 2), { name: 'corvale-backup.json' })

    // SEC-53: read every receipt from the configured storage driver. Under
    // RECEIPT_STORAGE_DRIVER=s3 there is no local copy, so the export must fetch the bytes
    // from object storage — and fail loudly rather than ship a ZIP that looks complete but
    // silently omits every receipt (the `privacy.md` export promise).
    const fromObjectStorage = isObjectStorageConfigured()

    for (const receipt of payload.receipts) {
        const storedFilename = String(receipt.storedFilename ?? '')
        if (!storedFilename) {
            continue
        }

        if (fromObjectStorage) {
            let buffer: Buffer
            try {
                buffer = await getReceiptObjectBuffer(receiptObjectKey(userId, storedFilename))
            } catch {
                throw new CustomError(ERROR_MESSAGES.BACKUP.RECEIPT_EXPORT_FAILED, 500)
            }
            archive.append(buffer, { name: `receipts/${storedFilename}` })
            continue
        }

        const filePath = getReceiptFilePath(userId, storedFilename)
        if (fs.existsSync(filePath)) {
            archive.file(filePath, { name: `receipts/${storedFilename}` })
        }
    }

    void archive.finalize()

    const scopeLabel = payload.scope.workspaceId ? 'workspace' : 'personal'
    const filename = `corvale-backup-${scopeLabel}-${payload.exportedAt.slice(0, 10)}`

    return { stream, filename }
}

export const extractBackupFromUpload = (
    buffer: Buffer,
    originalFilename: string
): { payload: CorvaleBackupPayload; receiptFiles: Map<string, Buffer> } => {
    const lowerName = originalFilename.toLowerCase()

    const maxJsonBytes = getBackupMaxJsonBytes()

    if (lowerName.endsWith('.json')) {
        if (buffer.byteLength > maxJsonBytes) {
            throw new CustomError(ERROR_MESSAGES.BACKUP.FILE_TOO_LARGE, 400)
        }

        let parsed: unknown
        try {
            parsed = JSON.parse(buffer.toString('utf8'))
        } catch {
            throw new CustomError(ERROR_MESSAGES.BACKUP.INVALID_FORMAT, 400)
        }

        return { payload: parseBackupPayload(parsed), receiptFiles: new Map() }
    }

    if (lowerName.endsWith('.zip')) {
        if (buffer.byteLength > BACKUP_MAX_ZIP_BYTES) {
            throw new CustomError(ERROR_MESSAGES.BACKUP.FILE_TOO_LARGE, 400)
        }

        const zip = new AdmZip(buffer)
        const entries = zip.getEntries()

        // Bound entry count, declared uncompressed size, and per-entry compression ratio from
        // the central directory alone, before calling getData() on anything (S15/SEC-16) - a
        // small, highly-compressible zip must be rejected without ever being inflated.
        if (entries.length > getBackupMaxZipEntries()) {
            throw new CustomError(ERROR_MESSAGES.BACKUP.ARCHIVE_TOO_MANY_ENTRIES, 400)
        }

        const maxUncompressedBytes = getBackupMaxUncompressedBytes()
        const maxCompressionRatio = getBackupMaxCompressionRatio()
        let totalUncompressedBytes = 0

        for (const entry of entries) {
            if (entry.isDirectory) {
                continue
            }

            totalUncompressedBytes += entry.header.size
            if (totalUncompressedBytes > maxUncompressedBytes) {
                throw new CustomError(ERROR_MESSAGES.BACKUP.ARCHIVE_UNCOMPRESSED_TOO_LARGE, 400)
            }

            if (
                entry.header.compressedSize > 0 &&
                entry.header.size / entry.header.compressedSize > maxCompressionRatio
            ) {
                throw new CustomError(ERROR_MESSAGES.BACKUP.ARCHIVE_SUSPICIOUS_RATIO, 400)
            }
        }

        // V7.3b rename-compat: new exports write `corvale-backup.json`, but a ZIP a tester
        // downloaded before the rename has `spndr-backup.json` — keep reading both for one
        // release so backups stay the working escape hatch. See ROADMAP's V7 compat matrix.
        const jsonEntry =
            zip.getEntry('corvale-backup.json') ??
            zip.getEntry('spndr-backup.json') ??
            entries.find(
                (entry) =>
                    !entry.isDirectory &&
                    (entry.entryName.endsWith('corvale-backup.json') ||
                        entry.entryName.endsWith('spndr-backup.json'))
            )

        if (!jsonEntry) {
            throw new CustomError(ERROR_MESSAGES.BACKUP.INVALID_FORMAT, 400)
        }

        // SEC-50: the `.json` branch above bounds the payload; the zip branch must too. Check
        // the declared size from the central directory first, then the inflated buffer.
        if (jsonEntry.header.size > maxJsonBytes) {
            throw new CustomError(ERROR_MESSAGES.BACKUP.FILE_TOO_LARGE, 400)
        }

        let jsonBuffer: Buffer
        try {
            jsonBuffer = jsonEntry.getData()
        } catch {
            throw new CustomError(ERROR_MESSAGES.BACKUP.INVALID_FORMAT, 400)
        }
        if (jsonBuffer.byteLength > maxJsonBytes) {
            throw new CustomError(ERROR_MESSAGES.BACKUP.FILE_TOO_LARGE, 400)
        }

        let parsed: unknown
        try {
            parsed = JSON.parse(jsonBuffer.toString('utf8'))
        } catch {
            throw new CustomError(ERROR_MESSAGES.BACKUP.INVALID_FORMAT, 400)
        }

        const payload = parseBackupPayload(parsed)
        const receiptFiles = new Map<string, Buffer>()

        for (const entry of entries) {
            if (entry.isDirectory || !entry.entryName.startsWith('receipts/')) {
                continue
            }
            const storedFilename = path.basename(entry.entryName)
            receiptFiles.set(storedFilename, entry.getData())
        }

        return { payload, receiptFiles }
    }

    throw new CustomError(ERROR_MESSAGES.BACKUP.INVALID_FILE_TYPE, 400)
}
