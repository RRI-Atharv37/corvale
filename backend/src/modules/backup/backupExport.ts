import fs from 'fs'
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

import { Account } from '@modules/accounts'
import { Budget } from '@modules/budgets'
import { CategorizationRule } from '@modules/categorization-rules'
import { Category } from '@modules/categories'
import { Receipt } from '@modules/receipts'
import { RecurringRule } from '@modules/recurring'
import { SavingsGoal } from '@modules/savings-goals'
import { SavingsGoalContribution } from '@modules/savings-goals'
import { Tag } from '@modules/tags'
import { Transaction } from '@modules/transactions'
import { TransactionTemplate } from '@modules/transaction-templates'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    getReceiptObjectBuffer,
    isObjectStorageConfigured,
    receiptObjectKey,
} from '@infra/storage/receiptStorage'
import { buildScopedListFilter } from '@core/access/workspace'
import { getReceiptFilePath } from '@modules/receipts/receiptUtils'

import { BACKUP_VERSION, buildCounts, emptyCounts, type CorvaleBackupPayload } from './backupFormat'

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
