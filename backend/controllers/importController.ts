import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import Transaction from '../models/Transaction'
import Category from '../models/Category'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import {
    applyCategorizationRules,
    mergeTags,
} from '../utils/categorizationRuleUtils'
import { evaluateBudgetOverLimitNotifications } from '../utils/notificationUtils'
import { fromMinorUnits } from '../utils/moneyUtils'
import { parseClientAmount } from '../utils/transactionUtils'
import {
    applyTransactionToAccount,
    validateAccountForTransaction,
    validateCategoryForTransaction,
} from '../utils/transactionUtils'
import {
    assertImportRowLimit,
    buildImportFingerprint,
    detectImportFormat,
    IMPORT_DELIMITERS,
    IMPORT_PREVIEW_SAMPLE_ROWS,
    ImportDelimiter,
    ImportDuplicateAction,
    ImportDuplicateMatch,
    ImportRowError,
    isOfxContent,
    isQifContent,
    mapCsvRows,
    parseCsvContent,
    parseImportMapping,
    parseImportRowDecisions,
    parseOfxContent,
    parseQifContent,
    ParsedImportRow,
    sanitizeParsedImportRows,
    suggestColumnMapping,
    toImportIsoDate,
} from '../utils/csvImportUtils'
import {
    assertAccountMatchesWorkspace,
    assertWorkspaceMembership,
    parseOptionalWorkspaceId,
} from '../utils/workspaceUtils'
import { getUserId, handleResponses, validateRequiredFields } from '../utils/sharedUtils'

interface ImportPreviewItem {
    rowIndex: number
    date: string
    title: string
    description?: string
    amount: number
    type: 'income' | 'expense'
    externalId?: string
    categoryId: string
    categoryName?: string
    tags?: string[]
    appliedRuleId?: string
    appliedRuleName?: string
    error?: string
    duplicateOf?: ImportDuplicateMatch
    duplicateAction?: ImportDuplicateAction
}

const buildPreviewItems = async (
    userId: string,
    accountId: string,
    defaultCategoryId: string,
    rows: ParsedImportRow[]
): Promise<ImportPreviewItem[]> => {
    const categoryCache = new Map<string, string>()

    const resolveCategoryName = async (categoryId: string): Promise<string | undefined> => {
        if (categoryCache.has(categoryId)) {
            return categoryCache.get(categoryId)
        }
        const category = await Category.findById(categoryId).select('name')
        const name = category?.name
        if (name) {
            categoryCache.set(categoryId, name)
        }
        return name
    }

    return Promise.all(
        rows.map(async (row) => {
            try {
                const amountMinor = parseClientAmount(row.amount)
                const ruleResult = await applyCategorizationRules(userId, {
                    title: row.title,
                    description: row.description,
                    amount: amountMinor,
                    accountId,
                    type: row.type,
                })

                const categoryId = ruleResult?.categoryId.toString() ?? defaultCategoryId
                await validateCategoryForTransaction(categoryId, userId)
                const categoryName = await resolveCategoryName(categoryId)

                return {
                    rowIndex: row.rowIndex,
                    date: row.date,
                    title: row.title,
                    description: row.description,
                    amount: row.amount,
                    type: row.type,
                    externalId: row.externalId,
                    categoryId,
                    categoryName,
                    tags: ruleResult ? mergeTags(undefined, ruleResult.tags) : undefined,
                    appliedRuleId: ruleResult?.ruleId.toString(),
                    appliedRuleName: ruleResult?.ruleName,
                }
            } catch (error) {
                return {
                    rowIndex: row.rowIndex,
                    date: row.date,
                    title: row.title,
                    description: row.description,
                    amount: row.amount,
                    type: row.type,
                    externalId: row.externalId,
                    categoryId: defaultCategoryId,
                    error: error instanceof Error ? error.message : 'Failed to map row',
                }
            }
        })
    )
}

interface ExistingDuplicateMaps {
    /** `buildImportFingerprint` key → match (fuzzy date/type/amount/description). */
    fingerprintMap: Map<string, ImportDuplicateMatch>
    /** `externalId` (OFX FITID) → match. Exact; checked first (BUG-21). */
    externalIdMap: Map<string, ImportDuplicateMatch>
}

const loadExistingDuplicateMap = async (
    userId: string,
    accountId: string,
    rows: ParsedImportRow[]
): Promise<ExistingDuplicateMaps> => {
    const fingerprintMap = new Map<string, ImportDuplicateMatch>()
    const externalIdMap = new Map<string, ImportDuplicateMatch>()
    if (rows.length === 0) {
        return { fingerprintMap, externalIdMap }
    }

    const dates = rows.map((row) => new Date(`${row.date}T12:00:00.000Z`).getTime())
    const minDate = new Date(Math.min(...dates))
    minDate.setUTCHours(0, 0, 0, 0)
    const maxDate = new Date(Math.max(...dates))
    maxDate.setUTCHours(23, 59, 59, 999)

    const externalIds = [...new Set(rows.map((row) => row.externalId).filter((id): id is string => !!id))]

    const existingTransactions = await Transaction.find({
        userId,
        accountId,
        status: 'posted',
        splitTransactionId: null,
        $or: [
            { date: { $gte: minDate, $lte: maxDate } },
            ...(externalIds.length > 0 ? [{ externalId: { $in: externalIds } }] : []),
        ],
    })
        .select('date amount type title description categoryId externalId')
        .populate('categoryId', 'name')

    const categoryNameFromDoc = (categoryId: unknown): string | undefined => {
        if (!categoryId || typeof categoryId !== 'object') {
            return undefined
        }
        const name = (categoryId as { name?: string }).name
        return typeof name === 'string' ? name : undefined
    }

    for (const transaction of existingTransactions) {
        const isoDate = toImportIsoDate(transaction.date)
        const match: ImportDuplicateMatch = {
            transactionId: transaction._id.toString(),
            title: transaction.title,
            date: isoDate,
            amount: fromMinorUnits(transaction.amount),
            categoryName: categoryNameFromDoc(transaction.categoryId),
        }

        if (transaction.externalId && !externalIdMap.has(transaction.externalId)) {
            externalIdMap.set(transaction.externalId, match)
        }

        const fingerprint = buildImportFingerprint(
            isoDate,
            transaction.type as 'income' | 'expense',
            transaction.amount,
            transaction.title,
            transaction.description
        )
        if (!fingerprintMap.has(fingerprint)) {
            fingerprintMap.set(fingerprint, match)
        }
    }

    return { fingerprintMap, externalIdMap }
}

const attachDuplicateInfo = async (
    userId: string,
    accountId: string,
    items: ImportPreviewItem[],
    importRows: ParsedImportRow[]
): Promise<ImportPreviewItem[]> => {
    const validRows = importRows.filter((row) =>
        items.some((item) => item.rowIndex === row.rowIndex && !item.error)
    )
    const { fingerprintMap, externalIdMap } = await loadExistingDuplicateMap(userId, accountId, validRows)

    return items.map((item) => {
        if (item.error) {
            return item
        }

        const row = importRows.find((candidate) => candidate.rowIndex === item.rowIndex)
        if (!row) {
            return item
        }

        const amountMinor = parseClientAmount(row.amount)
        const duplicateOf =
            (row.externalId ? externalIdMap.get(row.externalId) : undefined) ??
            fingerprintMap.get(
                buildImportFingerprint(row.date, row.type, amountMinor, row.title, row.description)
            )

        if (!duplicateOf) {
            return item
        }

        return {
            ...item,
            duplicateOf,
            duplicateAction: 'skip' as const,
        }
    })
}

const summarizePreview = (items: ImportPreviewItem[]) => {
    const validItems = items.filter((item) => !item.error)
    const duplicateItems = validItems.filter((item) => item.duplicateOf)
    const incomeTotal = validItems
        .filter((item) => item.type === 'income')
        .reduce((sum, item) => sum + item.amount, 0)
    const expenseTotal = validItems
        .filter((item) => item.type === 'expense')
        .reduce((sum, item) => sum + item.amount, 0)

    return {
        total: items.length,
        valid: validItems.length,
        invalid: items.length - validItems.length,
        duplicates: duplicateItems.length,
        incomeTotal,
        expenseTotal,
    }
}

const resolveDuplicateAction = (
    item: ImportPreviewItem,
    rowDecisions: Map<number, ImportDuplicateAction>
): ImportDuplicateAction => {
    if (!item.duplicateOf) {
        return 'import'
    }
    return rowDecisions.get(item.rowIndex) ?? item.duplicateAction ?? 'skip'
}

const mergeImportIntoTransaction = async (
    userId: string,
    transactionId: string,
    item: ImportPreviewItem
): Promise<void> => {
    const transaction = await Transaction.findOne({
        _id: transactionId,
        userId,
        status: 'posted',
    })

    if (!transaction) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND, 404)
    }

    transaction.categoryId = new Types.ObjectId(item.categoryId)
    if (item.tags?.length) {
        transaction.tags = mergeTags(transaction.tags, item.tags)
    }
    if (item.description && !transaction.description) {
        transaction.description = item.description
    }

    await transaction.save()
    await evaluateBudgetOverLimitNotifications(userId, transaction)
}

/**
 * Resolves the import rows + row-level errors for preview/commit. The OFX/QIF path sends
 * `parsedRows` (+ `parsedRowErrors` from parse time, BUG-21/BUG-23) straight back; the CSV path
 * sends `headers`/`rows`/`mapping` and is re-mapped here.
 */
const resolveRowsAndErrors = (
    body: Record<string, unknown>
): { importRows: ParsedImportRow[]; rowErrors: ImportRowError[] } => {
    const { headers, rows, mapping, parsedRows, parsedRowErrors } = body

    if (Array.isArray(parsedRows) && parsedRows.length > 0) {
        // `parsedRows` is a client round-trip of the OFX/QIF parse output — untrusted on the way
        // back in. Validate every row server-side (SEC-52): `type` constrained to income/expense
        // so a posted `"transfer"` can't create an orphan transfer leg.
        const importRows = sanitizeParsedImportRows(parsedRows)
        const carried = Array.isArray(parsedRowErrors)
            ? (parsedRowErrors as unknown[])
                  .filter(
                      (entry): entry is ImportRowError =>
                          !!entry &&
                          typeof entry === 'object' &&
                          typeof (entry as ImportRowError).rowIndex === 'number' &&
                          typeof (entry as ImportRowError).message === 'string'
                  )
                  .map((entry) => ({ rowIndex: entry.rowIndex, message: entry.message }))
            : []
        return { importRows, rowErrors: carried }
    }

    if (!Array.isArray(headers) || !Array.isArray(rows)) {
        throw new CustomError(ERROR_MESSAGES.IMPORT.MAPPING_INCOMPLETE, 400)
    }
    const mapped = mapCsvRows(headers, rows, parseImportMapping(mapping))
    return { importRows: mapped.rows, rowErrors: mapped.errors }
}

export const parseImportFile = asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file?.buffer) {
        throw new CustomError(ERROR_MESSAGES.IMPORT.FILE_REQUIRED, 400)
    }

    const content = req.file.buffer.toString('utf-8')
    if (!content.trim()) {
        throw new CustomError(ERROR_MESSAGES.IMPORT.EMPTY_FILE, 400)
    }

    const extension = req.file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
    const looksOfx = isOfxContent(content)
    const looksQif = !looksOfx && isQifContent(content)

    if (looksOfx || looksQif) {
        const parsed = looksQif ? parseQifContent(content) : parseOfxContent(content)
        assertImportRowLimit(parsed.rows.length + parsed.errors.length)

        handleResponses(res, 200, {
            format: looksQif ? 'qif' : 'ofx',
            fileName: req.file.originalname,
            totalRows: parsed.rows.length,
            sampleRows: parsed.rows.slice(0, IMPORT_PREVIEW_SAMPLE_ROWS),
            parsedRows: parsed.rows,
            parsedRowErrors: parsed.errors,
            statementCurrency: parsed.statementCurrency,
            requiresMapping: false,
        })
        return
    }

    // An .ofx/.qfx upload whose content is neither OFX nor QIF must not fall through to the CSV
    // parser — that produced a garbled mapping screen or an opaque error (BUG-23).
    if (extension === '.ofx' || extension === '.qfx') {
        throw new CustomError('This file does not look like a valid OFX/QFX or QIF file', 400)
    }

    const requestedDelimiter =
        typeof req.body?.delimiter === 'string' ? (req.body.delimiter as string) : undefined
    const delimiter = IMPORT_DELIMITERS.includes(requestedDelimiter as ImportDelimiter)
        ? (requestedDelimiter as ImportDelimiter)
        : undefined

    const { headers, rows, delimiter: resolvedDelimiter } = parseCsvContent(content, delimiter)
    assertImportRowLimit(rows.length)

    const format = detectImportFormat(headers)
    const suggestedMapping = suggestColumnMapping(headers, format)

    handleResponses(res, 200, {
        format,
        fileName: req.file.originalname,
        headers,
        totalRows: rows.length,
        sampleRows: rows.slice(0, IMPORT_PREVIEW_SAMPLE_ROWS),
        rows,
        suggestedMapping,
        delimiter: resolvedDelimiter,
        requiresMapping: true,
    })
})

export const previewImport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    validateRequiredFields(req.body, ['accountId', 'defaultCategoryId'])

    const { accountId, defaultCategoryId, workspaceId } = req.body

    const resolvedWorkspaceId = parseOptionalWorkspaceId(workspaceId) ?? null
    if (resolvedWorkspaceId) {
        await assertWorkspaceMembership(resolvedWorkspaceId, userId, 'editor')
    }

    const account = await validateAccountForTransaction(accountId, userId)
    assertAccountMatchesWorkspace(account.workspaceId, resolvedWorkspaceId)
    await validateCategoryForTransaction(defaultCategoryId, userId)

    const { importRows, rowErrors } = resolveRowsAndErrors(req.body)

    assertImportRowLimit(importRows.length + rowErrors.length)

    const previewItems = await buildPreviewItems(
        userId,
        accountId,
        defaultCategoryId,
        importRows
    )

    const itemsWithDuplicates = await attachDuplicateInfo(
        userId,
        accountId,
        previewItems,
        importRows
    )

    const errorItems: ImportPreviewItem[] = rowErrors.map((error) => ({
        rowIndex: error.rowIndex,
        date: '',
        title: '',
        amount: 0,
        type: 'expense',
        categoryId: defaultCategoryId,
        error: error.message,
    }))

    const items = [...itemsWithDuplicates, ...errorItems].sort((a, b) => a.rowIndex - b.rowIndex)

    handleResponses(res, 200, {
        items,
        summary: summarizePreview(items),
    })
})

export const commitImport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    validateRequiredFields(req.body, ['accountId', 'defaultCategoryId'])

    const { accountId, defaultCategoryId, workspaceId, rowDecisions: rawRowDecisions } = req.body

    const rowDecisions = parseImportRowDecisions(rawRowDecisions)

    const resolvedWorkspaceId = parseOptionalWorkspaceId(workspaceId) ?? null
    if (resolvedWorkspaceId) {
        await assertWorkspaceMembership(resolvedWorkspaceId, userId, 'editor')
    }

    const account = await validateAccountForTransaction(accountId, userId)
    assertAccountMatchesWorkspace(account.workspaceId, resolvedWorkspaceId)
    await validateCategoryForTransaction(defaultCategoryId, userId)

    const { importRows, rowErrors } = resolveRowsAndErrors(req.body)

    assertImportRowLimit(importRows.length + rowErrors.length)

    const previewItems = await buildPreviewItems(
        userId,
        accountId,
        defaultCategoryId,
        importRows
    )

    const itemsWithDuplicates = await attachDuplicateInfo(
        userId,
        accountId,
        previewItems,
        importRows
    )

    const validItems = itemsWithDuplicates.filter((item) => !item.error)
    if (validItems.length === 0) {
        throw new CustomError(ERROR_MESSAGES.IMPORT.NO_VALID_ROWS, 400)
    }

    const createdIds: string[] = []
    const mergedIds: string[] = []
    let skipped = previewItems.length - validItems.length + rowErrors.length

    for (const item of validItems) {
        const action = resolveDuplicateAction(item, rowDecisions)

        if (action === 'skip') {
            if (item.duplicateOf) {
                skipped += 1
            }
            continue
        }

        if (action === 'merge') {
            if (!item.duplicateOf) {
                throw new CustomError(ERROR_MESSAGES.IMPORT.INVALID_MERGE_TARGET, 400)
            }
            await mergeImportIntoTransaction(userId, item.duplicateOf.transactionId, item)
            mergedIds.push(item.duplicateOf.transactionId)
            continue
        }

        const amountMinor = parseClientAmount(item.amount)
        const transaction = await Transaction.create({
            userId,
            workspaceId: resolvedWorkspaceId,
            accountId,
            categoryId: item.categoryId,
            type: item.type,
            status: 'posted',
            amount: amountMinor,
            currency: account.currency,
            title: item.title,
            description: item.description,
            date: new Date(`${item.date}T12:00:00.000Z`),
            tags: item.tags,
            externalId: item.externalId,
        })

        await applyTransactionToAccount(account, item.type, amountMinor, transaction.date)
        await evaluateBudgetOverLimitNotifications(userId, transaction)
        createdIds.push(transaction._id.toString())
    }

    handleResponses(res, 201, {
        imported: createdIds.length,
        merged: mergedIds.length,
        skipped,
        transactionIds: createdIds,
        mergedTransactionIds: mergedIds,
        summary: summarizePreview([
            ...itemsWithDuplicates,
            ...rowErrors.map((error) => ({
                rowIndex: error.rowIndex,
                date: '',
                title: '',
                amount: 0,
                type: 'expense' as const,
                categoryId: defaultCategoryId,
                error: error.message,
            })),
        ]),
    })
})
