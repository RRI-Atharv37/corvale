import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Types } from 'mongoose'

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

import { Account } from '@modules/accounts'
import { refreshAccountBalances } from '@modules/accounts/accountBalance'
import { Budget } from '@modules/budgets'
import { CategorizationRule } from '@modules/categorization-rules'
import { Category } from '@modules/categories'
import { Receipt } from '@modules/receipts'
import { RecurringRule } from '@modules/recurring'
import { SavingsGoal } from '@modules/savings-goals'
import { SavingsGoalContribution } from '@modules/savings-goals'
import { Tag } from '@modules/tags'
import { Transaction } from '@modules/transactions'
import { isTransferRole, type TransferRole } from '@shared/transferDirection'
import { TransactionTemplate } from '@modules/transaction-templates'
import { releaseQuota, reserveQuota } from '@modules/billing/usage.service'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    deleteReceiptObject,
    isObjectStorageConfigured,
    putReceiptObject,
    receiptObjectKey,
} from '@infra/storage/receiptStorage'
import { scanUploadedFile } from '@infra/security/virusScanService'
import {
    assertValidReceiptBuffer,
    assertWithinReceiptStorageQuota,
    deleteReceiptFile,
    getReceiptFilePath,
} from '@modules/receipts/receiptUtils'

import {
    BACKUP_MAX_ZIP_BYTES,
    BACKUP_VERSION,
    buildCounts,
    emptyCounts,
    type BackupEntityCounts,
    type BackupRestorePreview,
    type BackupRestoreResult,
    type CorvaleBackupPayload,
} from './backupFormat'

// Read fresh on every call (not cached at module load) so tests can override via process.env,
// mirroring the pattern in middleware/rateLimitMiddleware.ts's createAuthRateLimiter.
const getBackupMaxUncompressedBytes = (): number =>
    Number(process.env.BACKUP_MAX_UNCOMPRESSED_BYTES) || 200 * 1024 * 1024
const getBackupMaxZipEntries = (): number =>
    Number(process.env.BACKUP_MAX_ZIP_ENTRIES) || 10_000
const getBackupMaxCompressionRatio = (): number =>
    Number(process.env.BACKUP_MAX_COMPRESSION_RATIO) || 100
// Cap on the deserialized `corvale-backup.json`. The `.json` upload branch always checked this
// against the raw buffer; the `.zip` branch never did (SEC-50) - the embedded JSON was bounded
// only by BACKUP_MAX_UNCOMPRESSED_BYTES (200 MB, and also covering receipt bytes).
const getBackupMaxJsonBytes = (): number =>
    Number(process.env.BACKUP_MAX_JSON_BYTES) || 10 * 1024 * 1024
// Per-section record cap (SEC-50). `parseBackupPayload` checked record *shape* but never
// *count*, so a payload under the JSON-size cap could still hold ~1.5 M records driving that
// many writes in one request.
const getBackupMaxRecordsPerCollection = (): number =>
    Number(process.env.BACKUP_MAX_RECORDS_PER_COLLECTION) || 100_000

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

        // Per-record shape check - previously the payload was trusted wholesale past the
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
 * Restore no longer trusts a receipt record's `mimeType`/`size` - both are re-derived from the
 * actual bytes (SEC-28) - but a structurally broken record should still be rejected up front
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

    // `mimeType` and `size` are only shape-checked here, not enforced - restore ignores both
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

const describeBackup = (
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

interface MasterCategories {
    ids: Set<string>
    otherId: string | null
}

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i

const loadMasterCategories = async (): Promise<MasterCategories> => {
    const masters = await Category.find({ userId: null, masterCategoryId: null })
        .select('_id name')
        .lean()
    return {
        ids: new Set(masters.map((category) => category._id.toString())),
        otherId: masters.find((category) => category.name === 'Other')?._id.toString() ?? null,
    }
}

interface WritableModel {
    new (doc: Record<string, unknown>): { validateSync: () => unknown }
    insertMany: (docs: Record<string, unknown>[]) => Promise<unknown>
    deleteMany: (filter: Record<string, unknown>) => PromiseLike<unknown>
}

interface RestoreStep {
    countKey: keyof BackupEntityCounts
    model: WritableModel
    docs: Record<string, unknown>[]
}

interface PlannedReceipt {
    newId: Types.ObjectId
    record: Record<string, unknown>
    buffer: Buffer
}

interface RestorePlan {
    warnings: string[]
    tagRecords: Record<string, unknown>[]
    receipts: PlannedReceipt[]
    steps: RestoreStep[]
    idMapping: Map<string, string>
}

const assignIds = (records: Record<string, unknown>[]) => {
    const ids = records.map(() => new Types.ObjectId())
    const map = new Map<string, string>()
    records.forEach((record, index) => map.set(String(record.id), ids[index].toString()))
    return { ids, map }
}

/**
 * Resolves every reference in the backup and builds every document before anything is written, so a
 * broken reference or an invalid record is reported (preview) or rejected (restore) with the target
 * untouched. Ids are generated up front, which lets transfer pairs, split parents and receipts be
 * linked in the documents themselves rather than patched in afterwards.
 */
const buildRestorePlan = (
    backup: CorvaleBackupPayload,
    userObjectId: Types.ObjectId,
    workspaceObjectId: Types.ObjectId | null,
    masters: MasterCategories,
    receiptFiles?: Map<string, Buffer>
): RestorePlan => {
    const masterCategoryIds = masters.ids
    // SEC-51: account and category references are resolved through their own maps, which only
    // ever hold ids created by this restore (plus the shared master categories). A crafted
    // backup can no longer install an identity mapping that a later record resolves as its
    // `accountId`/`categoryId`.
    const categoryIdMap = new Map<string, string>()
    for (const masterId of masterCategoryIds) {
        categoryIdMap.set(masterId, masterId)
    }

    const customCategories = backup.categories.filter(
        (record) => !masterCategoryIds.has(String(record.id))
    )
    const categories = assignIds(customCategories)
    categories.map.forEach((value, key) => categoryIdMap.set(key, value))

    const accounts = assignIds(backup.accounts)
    const budgets = assignIds(backup.budgets)
    const goals = assignIds(backup.savingsGoals)
    const recurringRules = assignIds(backup.recurringRules)
    const categorizationRules = assignIds(backup.categorizationRules)
    const templates = assignIds(backup.transactionTemplates)
    const transactions = assignIds(backup.transactions)

    const receipts: PlannedReceipt[] = []
    const receiptIdMap = new Map<string, string>()
    for (const record of backup.receipts) {
        const buffer = receiptFiles?.get(String(record.storedFilename ?? ''))
        if (!buffer) {
            continue
        }
        const newId = new Types.ObjectId()
        receiptIdMap.set(String(record.id), newId.toString())
        receipts.push({ newId, record, buffer })
    }

    // A receipt id whose file did not come back (JSON backups, a co-member's receipt in a workspace
    // export, a receipt deleted since) is dropped, as the restore docs describe.
    const restoredReceiptIds = (values: unknown): Types.ObjectId[] =>
        Array.isArray(values)
            ? values
                  .map((value) => receiptIdMap.get(String(value)))
                  .filter((value): value is string => value != null)
                  .map((value) => new Types.ObjectId(value))
            : []

    // A category the file names but does not carry (a co-member's private category in a workspace
    // backup exported before those were included) is filed under "Other" rather than blocking the
    // restore. Only an id shaped like a real one qualifies; anything else stays a broken reference.
    let refiledTransactions = 0
    let refiledRecurringRules = 0
    const mapCategoryOrOther = (value: unknown, onFallback: () => void): Types.ObjectId => {
        const id = String(value ?? '')
        const mapped = categoryIdMap.get(id)
        if (mapped) {
            return new Types.ObjectId(mapped)
        }
        if (masters.otherId && OBJECT_ID_PATTERN.test(id)) {
            onFallback()
            return new Types.ObjectId(masters.otherId)
        }
        throw new CustomError(ERROR_MESSAGES.BACKUP.BROKEN_REFERENCE, 400)
    }

    // Each restored leg gets its stored `transferRole`: the file's own when it carries one, else the
    // earlier-created leg is outbound (the first in the file on a tie). Legs still get distinct
    // creation times so a reader that falls back to creation order agrees with the role.
    const legCreatedAt = new Map<string, Date>()
    const legRole = new Map<string, TransferRole>()
    const positionBySourceId = new Map(backup.transactions.map((record, index) => [String(record.id), index]))
    const recordBySourceId = new Map(backup.transactions.map((record) => [String(record.id), record]))
    const createdAtMillis = (record: Record<string, unknown>): number => {
        const parsed = Date.parse(String(record.createdAt ?? ''))
        return Number.isNaN(parsed) ? 0 : parsed
    }
    for (const record of backup.transactions) {
        const sourceId = String(record.id)
        const pair = record.transferPairId ? recordBySourceId.get(String(record.transferPairId)) : undefined
        if (record.type !== 'transfer' || !pair || legCreatedAt.has(sourceId)) {
            continue
        }
        const delta = createdAtMillis(record) - createdAtMillis(pair)
        const recordIsOutbound = isTransferRole(record.transferRole)
            ? record.transferRole === 'out'
            : isTransferRole(pair.transferRole)
              ? pair.transferRole === 'in'
              : delta !== 0
                ? delta < 0
                : (positionBySourceId.get(sourceId) ?? 0) < (positionBySourceId.get(String(pair.id)) ?? 0)
        const outbound = recordIsOutbound ? record : pair
        const inbound = recordIsOutbound ? pair : record
        const outboundMillis = createdAtMillis(outbound) || Date.now()
        legRole.set(String(outbound.id), 'out')
        legRole.set(String(inbound.id), 'in')
        legCreatedAt.set(String(outbound.id), new Date(outboundMillis))
        legCreatedAt.set(String(inbound.id), new Date(Math.max(createdAtMillis(inbound), outboundMillis + 1)))
    }

    const steps: RestoreStep[] = [
        {
            countKey: 'categories',
            model: Category as unknown as WritableModel,
            docs: customCategories.map((record, index) => ({
                _id: categories.ids[index],
                userId: userObjectId,
                masterCategoryId: mapOptionalId(categoryIdMap, record.masterCategoryId, masterCategoryIds),
                name: record.name,
                icon: record.icon,
                color: record.color,
                isDefault: false,
                isArchived: record.isArchived ?? false,
                sortOrder: record.sortOrder ?? 0,
            })),
        },
        {
            countKey: 'accounts',
            model: Account as unknown as WritableModel,
            docs: backup.accounts.map((record, index) => ({
                _id: accounts.ids[index],
                userId: userObjectId,
                workspaceId: workspaceObjectId,
                name: record.name,
                type: record.type,
                currency: record.currency,
                // balanceUnit round-trips whatever unit the exported account was actually stored
                // in (Sprint C5) - a backup predating that field has none, so it correctly
                // defaults to 'major', matching what a pre-migration account's raw numbers mean.
                balanceUnit: record.balanceUnit === 'minor' ? 'minor' : 'major',
                openingBalance: record.openingBalance ?? 0,
                openingBalanceDate: record.openingBalanceDate
                    ? parseDate(record.openingBalanceDate)
                    : null,
                currentBalance: record.currentBalance ?? record.openingBalance ?? 0,
                isDefault: false,
                isArchived: record.isArchived ?? false,
            })),
        },
        {
            countKey: 'budgets',
            model: Budget as unknown as WritableModel,
            docs: backup.budgets.map((record, index) => ({
                _id: budgets.ids[index],
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
                accountIds: mapIdArray(accounts.map, record.accountIds),
                isArchived: record.isArchived ?? false,
            })),
        },
        {
            countKey: 'savingsGoals',
            model: SavingsGoal as unknown as WritableModel,
            docs: backup.savingsGoals.map((record, index) => ({
                _id: goals.ids[index],
                userId: userObjectId,
                workspaceId: workspaceObjectId,
                name: record.name,
                targetAmount: record.targetAmount,
                currentAmount: record.currentAmount ?? 0,
                currency: record.currency,
                targetDate: record.targetDate ? parseDate(record.targetDate) : null,
                status: record.status ?? 'active',
                accountId: mapOptionalId(accounts.map, record.accountId, new Set()),
                autoContribution: record.autoContribution ?? {},
                completedAt: record.completedAt ? parseDate(record.completedAt) : null,
            })),
        },
        {
            countKey: 'recurringRules',
            model: RecurringRule as unknown as WritableModel,
            docs: backup.recurringRules.map((record, index) => ({
                _id: recurringRules.ids[index],
                userId: userObjectId,
                workspaceId: workspaceObjectId,
                title: record.title,
                type: record.type,
                amount: record.amount,
                currency: record.currency,
                accountId: mapRequiredId(accounts.map, record.accountId),
                categoryId: mapCategoryOrOther(record.categoryId, () => (refiledRecurringRules += 1)),
                interval: record.interval,
                customIntervalDays: record.customIntervalDays,
                nextDueDate: parseDate(record.nextDueDate),
                description: record.description,
                paymentMethod: record.paymentMethod,
                tags: record.tags ?? [],
                isActive: record.isActive ?? true,
                isArchived: record.isArchived ?? false,
            })),
        },
        {
            countKey: 'categorizationRules',
            model: CategorizationRule as unknown as WritableModel,
            docs: backup.categorizationRules.map((record, index) => ({
                _id: categorizationRules.ids[index],
                userId: userObjectId,
                name: record.name,
                matchType: record.matchType,
                matchValue: record.matchValue,
                amountMin: record.amountMin,
                amountMax: record.amountMax,
                accountId: record.accountId
                    ? mapOptionalId(accounts.map, record.accountId, new Set())
                    : undefined,
                categoryId: mapRequiredId(categoryIdMap, record.categoryId),
                tags: record.tags ?? [],
                priority: record.priority ?? 0,
                isActive: record.isActive ?? true,
            })),
        },
        {
            countKey: 'transactionTemplates',
            model: TransactionTemplate as unknown as WritableModel,
            docs: backup.transactionTemplates.map((record, index) => ({
                _id: templates.ids[index],
                userId: userObjectId,
                name: record.name,
                type: record.type,
                amount: record.amount,
                accountId: mapRequiredId(accounts.map, record.accountId),
                categoryId: mapRequiredId(categoryIdMap, record.categoryId),
                tags: record.tags ?? [],
                description: record.description,
            })),
        },
        {
            countKey: 'transactions',
            model: Transaction as unknown as WritableModel,
            docs: backup.transactions.map((record, index) => ({
                _id: transactions.ids[index],
                userId: userObjectId,
                workspaceId: workspaceObjectId,
                accountId: mapRequiredId(accounts.map, record.accountId),
                categoryId: mapCategoryOrOther(record.categoryId, () => (refiledTransactions += 1)),
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
                transferPairId: record.transferPairId
                    ? mapOptionalId(transactions.map, record.transferPairId, new Set())
                    : null,
                splitTransactionId: record.splitTransactionId
                    ? mapOptionalId(transactions.map, record.splitTransactionId, new Set())
                    : null,
                recurringPaymentId: record.recurringPaymentId
                    ? mapOptionalId(recurringRules.map, record.recurringPaymentId, new Set())
                    : null,
                receiptIds: restoredReceiptIds(record.receiptIds),
                transferRole: legRole.get(String(record.id)) ?? null,
                ...(legCreatedAt.has(String(record.id)) ? { createdAt: legCreatedAt.get(String(record.id)) } : {}),
            })),
        },
        {
            countKey: 'savingsGoalContributions',
            model: SavingsGoalContribution as unknown as WritableModel,
            docs: backup.savingsGoalContributions.map((record) => ({
                _id: new Types.ObjectId(),
                userId: userObjectId,
                goalId: mapRequiredId(goals.map, record.goalId),
                amount: record.amount,
                type: record.type,
                note: record.note,
                contributedAt: parseDate(record.contributedAt),
            })),
        },
    ]

    for (const step of steps) {
        for (const doc of step.docs) {
            if (new step.model(doc).validateSync()) {
                throw new CustomError(ERROR_MESSAGES.BACKUP.INVALID_FORMAT, 400)
            }
        }
    }

    const idMapping = new Map<string, string>()
    for (const map of [
        accounts.map,
        categoryIdMap,
        budgets.map,
        goals.map,
        recurringRules.map,
        categorizationRules.map,
        templates.map,
        transactions.map,
        receiptIdMap,
    ]) {
        map.forEach((value, key) => idMapping.set(key, value))
    }

    const warnings: string[] = []
    if (refiledTransactions > 0 || refiledRecurringRules > 0) {
        warnings.push(
            `${refiledTransactions} transaction(s) and ${refiledRecurringRules} recurring rule(s) used categories that are not in this backup and were filed under Other.`
        )
    }

    return { warnings, tagRecords: backup.tags, receipts, steps, idMapping }
}

const analyzeBackup = async (
    backup: CorvaleBackupPayload,
    targetWorkspaceId: string | null,
    userObjectId: Types.ObjectId,
    receiptFiles?: Map<string, Buffer>
): Promise<{ preview: BackupRestorePreview; plan: RestorePlan | null }> => {
    const preview = describeBackup(backup, targetWorkspaceId)
    if (!preview.valid) {
        return { preview, plan: null }
    }

    const masters = await loadMasterCategories()
    const workspaceObjectId = targetWorkspaceId ? new Types.ObjectId(targetWorkspaceId) : null

    try {
        const plan = buildRestorePlan(
            backup,
            userObjectId,
            workspaceObjectId,
            masters,
            receiptFiles
        )
        return { preview: { ...preview, warnings: [...preview.warnings, ...plan.warnings] }, plan }
    } catch (error) {
        if (error instanceof CustomError) {
            return {
                preview: { ...preview, valid: false, errors: [...preview.errors, error.message] },
                plan: null,
            }
        }
        throw error
    }
}

export const previewBackupRestore = async (
    backup: CorvaleBackupPayload,
    targetWorkspaceId: string | null
): Promise<BackupRestorePreview> => {
    const { preview } = await analyzeBackup(backup, targetWorkspaceId, new Types.ObjectId())
    return preview
}

interface WrittenRows {
    model: WritableModel
    ids: Types.ObjectId[]
}

interface ReservedReceipt {
    storedFilename: string
    size: number
}

const restoreReceipt = async (
    userId: string,
    userObjectId: Types.ObjectId,
    planned: PlannedReceipt,
    written: WrittenRows[],
    reserved: ReservedReceipt[]
): Promise<void> => {
    const { record, buffer, newId } = planned

    // Restore used to write the file blind and copy `mimeType`/`size` straight from the
    // backup JSON (SEC-28), skipping every control `POST /receipts` enforces. Run the
    // same pipeline here: sniff the real bytes, allowlist the detected type, size from
    // the buffer, per-user quota, then virus-scan the written file.
    const detectedMimeType = assertValidReceiptBuffer(buffer)
    const actualSize = buffer.byteLength

    await assertWithinReceiptStorageQuota(userId, actualSize)
    await reserveQuota(userId, 'receiptBytes', actualSize)

    const ext = path.extname(String(record.originalFilename ?? '')).toLowerCase()
    const safeExt = ext.length <= 10 ? ext : ''
    const newStoredFilename = `${crypto.randomUUID()}${safeExt}`
    reserved.push({ storedFilename: newStoredFilename, size: actualSize })

    const destPath = getReceiptFilePath(userId, newStoredFilename)
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.writeFileSync(destPath, buffer)

    await scanUploadedFile(destPath)

    if (isObjectStorageConfigured()) {
        await putReceiptObject(receiptObjectKey(userId, newStoredFilename), destPath, detectedMimeType)
        // Object storage is the only durable copy - the local write was staging for the
        // scan and the upload, exactly as in `uploadReceipt` (SEC-23).
        deleteReceiptFile(userId, newStoredFilename)
    }

    written.push({ model: Receipt as unknown as WritableModel, ids: [newId] })
    await Receipt.create({
        _id: newId,
        userId: userObjectId,
        originalFilename: record.originalFilename,
        storedFilename: newStoredFilename,
        mimeType: detectedMimeType,
        size: actualSize,
    })
}

const rollbackRestore = async (
    userId: string,
    userObjectId: Types.ObjectId,
    written: WrittenRows[],
    reserved: ReservedReceipt[]
): Promise<void> => {
    for (const { model, ids } of [...written].reverse()) {
        try {
            await model.deleteMany({ userId: userObjectId, _id: { $in: ids } })
        } catch {
            // Best effort: the original failure is what the caller must see.
        }
    }

    for (const receipt of reserved) {
        try {
            deleteReceiptFile(userId, receipt.storedFilename)
            if (isObjectStorageConfigured()) {
                await deleteReceiptObject(receiptObjectKey(userId, receipt.storedFilename))
            }
        } catch {
            // Best effort, as above.
        }
        try {
            await releaseQuota(userId, 'receiptBytes', receipt.size)
        } catch {
            // Best effort, as above.
        }
    }
}

export const restoreUserBackup = async (
    userId: string,
    backup: CorvaleBackupPayload,
    targetWorkspaceId: string | null,
    receiptFiles?: Map<string, Buffer>
): Promise<BackupRestoreResult> => {
    const userObjectId = new Types.ObjectId(userId)
    const { preview, plan } = await analyzeBackup(backup, targetWorkspaceId, userObjectId, receiptFiles)
    if (!plan) {
        throw new CustomError(preview.errors.join(' '), 400)
    }

    const created = emptyCounts()
    const written: WrittenRows[] = []
    const reserved: ReservedReceipt[] = []
    const tagIdMap = new Map<string, string>()

    try {
        for (const planned of plan.receipts) {
            await restoreReceipt(userId, userObjectId, planned, written, reserved)
        }
        created.receipts = plan.receipts.length

        for (const record of plan.tagRecords) {
            const sourceId = String(record.id)
            const existing = await Tag.findOne({ userId, name: record.name })
            if (existing) {
                tagIdMap.set(sourceId, existing._id.toString())
                continue
            }

            const createdTag = await Tag.create({
                userId: userObjectId,
                name: record.name,
                color: record.color,
            })
            written.push({ model: Tag as unknown as WritableModel, ids: [createdTag._id] })
            tagIdMap.set(sourceId, createdTag._id.toString())
            created.tags += 1
        }

        for (const step of plan.steps) {
            if (step.docs.length === 0) {
                continue
            }
            written.push({
                model: step.model,
                ids: step.docs
                    .map((doc) => doc._id)
                    .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId),
            })
            await step.model.insertMany(step.docs)
            created[step.countKey] = step.docs.length
        }

        const restoredAccountIds = plan.steps
            .filter((step) => step.countKey === 'accounts')
            .flatMap((step) => step.docs.map((doc) => doc._id as Types.ObjectId))
        await refreshAccountBalances(restoredAccountIds)
    } catch (error) {
        await rollbackRestore(userId, userObjectId, written, reserved)
        throw error
    }

    return {
        created,
        idMapping: Object.fromEntries([...plan.idMapping.entries(), ...tagIdMap.entries()]),
        ...(plan.warnings.length > 0 ? { warnings: plan.warnings } : {}),
    }
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
        // downloaded before the rename has `spndr-backup.json` - keep reading both for one
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
