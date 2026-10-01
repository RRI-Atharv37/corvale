import { Types } from 'mongoose'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { resolveDateRange } from '@core/time/timezoneUtils'
import {
    attachTransferDirections,
    CSV_HEADERS,
    buildCategorySortLookupStages,
    buildTransactionSort,
    enrichTransactionsForWorkspace,
    formatTransactionCsvRow,
    LISTABLE_TRANSACTION_FILTER,
    parseClientAmount,
    serializeTransaction,
    serializeTransactionPlain,
    serializeTransactions,
    STRIP_CATEGORY_SORT_JOIN,
    Transaction,
    validateRequiredFields,
    buildSearchRegex,
} from './transactionUtils'
import {
    buildTransactionExportRecord,
    parseExportFormat,
    parseTransactionExportType,
} from './export'
import { CLEARED_STATUSES, TRANSACTION_STATUSES, TRANSACTION_TYPES } from './transaction.model'
import { buildScopedListFilter } from '@core/access/workspace'
import { RLS_ALLOW_LOOKUP } from '@core/access/rowLevelSecurity'
import { buildTagFilter, parseTagsQuery } from '@modules/tags/tagUtils'
import { assertWorkspaceMembership } from '@modules/workspaces/access'
import { Category } from '@modules/categories'

export { CSV_HEADERS }

export const MAX_PAGE_SIZE = 500

const parsePositiveInteger = (value: unknown, fallback: number): number => {
    if (value === undefined) {
        return fallback
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
        throw new CustomError('Invalid page or limit number', 400)
    }
    const parsed = typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : NaN
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new CustomError('Invalid page or limit number', 400)
    }
    return parsed
}

export const parsePagination = (page: unknown, limit: unknown) => {
    const pageNumber = parsePositiveInteger(page, 1)
    const limitNumber = Math.min(parsePositiveInteger(limit, 10), MAX_PAGE_SIZE)

    return { pageNumber, limitNumber }
}

const parseClearedStatusFilter = (value: unknown): string | { $in: string[] } => {
    const members = typeof value === 'string' ? value.split(',') : []
    const invalid =
        members.length === 0 ||
        members.some((member) => !CLEARED_STATUSES.includes(member as (typeof CLEARED_STATUSES)[number]))
    if (invalid) {
        throw new CustomError(
            `Invalid clearedStatus filter. Must be one of: ${CLEARED_STATUSES.join(', ')}`,
            400
        )
    }
    return members.length === 1 ? members[0] : { $in: [...new Set(members)] }
}

const buildListFilter = (
    userId: string,
    type?: unknown,
    workspaceId?: string | null,
    tags?: unknown,
    clearedStatus?: unknown,
    accountId?: unknown,
    status?: unknown
) => {
    const filter: Record<string, unknown> = {
        ...buildScopedListFilter(userId, workspaceId),
        ...LISTABLE_TRANSACTION_FILTER,
    }

    if (type !== undefined && type !== '') {
        if (!TRANSACTION_TYPES.includes(type as (typeof TRANSACTION_TYPES)[number])) {
            throw new CustomError(
                `Invalid type filter. Must be one of: ${TRANSACTION_TYPES.join(', ')}`,
                400
            )
        }
        filter.type = type
    }

    if (status !== undefined && status !== '') {
        if (!TRANSACTION_STATUSES.includes(status as (typeof TRANSACTION_STATUSES)[number])) {
            throw new CustomError(
                `Invalid status filter. Must be one of: ${TRANSACTION_STATUSES.join(', ')}`,
                400
            )
        }
        filter.status = status
    }

    if (clearedStatus !== undefined && clearedStatus !== '') {
        filter.clearedStatus = parseClearedStatusFilter(clearedStatus)
    }

    if (accountId !== undefined && accountId !== '') {
        if (typeof accountId !== 'string' || !Types.ObjectId.isValid(accountId)) {
            throw new CustomError(ERROR_MESSAGES.TRANSACTION.INVALID_ACCOUNT_ID_FILTER, 400)
        }
        filter.accountId = accountId
    }

    const tagNames = parseTagsQuery(tags)
    if (tagNames) {
        Object.assign(filter, buildTagFilter(tagNames))
    }

    return filter
}

const resolveListWorkspaceId = async (
    userId: string,
    rawWorkspaceId: string | null
): Promise<string | null> => {
    if (rawWorkspaceId) {
        await assertWorkspaceMembership(rawWorkspaceId, userId, 'viewer')
    }
    return rawWorkspaceId
}

type Query = Record<string, unknown>

export interface QueryInput {
    userId: string
    workspaceId: string | null
    timezone: string
    query: Query
}

export const listTransactions = async (input: QueryInput) => {
    const { userId, query } = input
    const { type, sortBy, sortOrder, tags, clearedStatus, accountId, status } = query
    const { pageNumber, limitNumber } = parsePagination(query.page, query.limit)
    const workspaceId = await resolveListWorkspaceId(userId, input.workspaceId)
    const filter = buildListFilter(userId, type, workspaceId, tags, clearedStatus, accountId, status)

    if (sortBy === 'category') {
        const [results, totalCount] = await Promise.all([
            Transaction.aggregate([
                { $match: filter },
                ...buildCategorySortLookupStages(userId),
                { $sort: buildTransactionSort(sortBy as string, sortOrder as string) },
                { $skip: (pageNumber - 1) * limitNumber },
                { $limit: limitNumber },
                STRIP_CATEGORY_SORT_JOIN,
            ]).option({ [RLS_ALLOW_LOOKUP]: true }),
            Transaction.countDocuments(filter),
        ])

        const data = await attachTransferDirections(
            await enrichTransactionsForWorkspace(
                workspaceId,
                results.map((doc) => serializeTransactionPlain(doc))
            )
        )

        return {
            data,
            meta: {
                totalTransactions: totalCount,
                pageNumber,
                totalPages: Math.ceil(totalCount / limitNumber),
                limit: limitNumber,
            },
        }
    }

    const sort = buildTransactionSort(sortBy as string | undefined, sortOrder as string | undefined)
    const [transactions, totalTransactions] = await Promise.all([
        Transaction.find(filter)
            .sort(sort)
            .skip((pageNumber - 1) * limitNumber)
            .limit(limitNumber),
        Transaction.countDocuments(filter),
    ])

    return {
        data: await attachTransferDirections(
            await enrichTransactionsForWorkspace(workspaceId, serializeTransactions(transactions))
        ),
        meta: {
            totalTransactions,
            pageNumber,
            totalPages: Math.ceil(totalTransactions / limitNumber),
            limit: limitNumber,
        },
    }
}

const resolveRange = (
    startDate: unknown,
    endDate: unknown,
    timezone: string
): { start: Date; end: Date } => {
    try {
        return resolveDateRange(startDate as string, endDate as string, timezone)
    } catch (error) {
        throw new CustomError(error instanceof Error ? error.message : 'Invalid date range', 400)
    }
}

export const filterTransactions = async (input: QueryInput) => {
    const { userId, query, timezone } = input
    const { startDate, endDate, type, sortBy, sortOrder, tags, clearedStatus, status } = query

    validateRequiredFields({ startDate, endDate }, ['startDate', 'endDate'])
    const dateRange = resolveRange(startDate, endDate, timezone)

    const workspaceId = await resolveListWorkspaceId(userId, input.workspaceId)

    const filter = {
        ...buildListFilter(userId, type, workspaceId, tags, clearedStatus, undefined, status),
        date: { $gte: dateRange.start, $lte: dateRange.end },
    }

    if (sortBy === 'category') {
        const results = await Transaction.aggregate([
            { $match: filter },
            ...buildCategorySortLookupStages(userId),
            { $sort: buildTransactionSort(sortBy as string, sortOrder as string) },
            STRIP_CATEGORY_SORT_JOIN,
        ]).option({ [RLS_ALLOW_LOOKUP]: true })

        return attachTransferDirections(
            await enrichTransactionsForWorkspace(
                workspaceId,
                results.map((doc) => serializeTransactionPlain(doc))
            )
        )
    }

    const sort = buildTransactionSort(sortBy as string | undefined, sortOrder as string | undefined)
    const transactions = await Transaction.find(filter).sort(sort)
    return attachTransferDirections(
        await enrichTransactionsForWorkspace(workspaceId, serializeTransactions(transactions))
    )
}

export const searchTransactions = async (input: QueryInput) => {
    const { userId, query } = input
    const { keyword, type, sortBy, sortOrder, tags } = query

    validateRequiredFields({ keyword }, ['keyword'])

    const regex = buildSearchRegex(keyword as string)
    let numericKeyword: number | null = null
    try {
        numericKeyword = parseClientAmount(keyword)
    } catch {
        numericKeyword = null
    }
    const workspaceId = await resolveListWorkspaceId(userId, input.workspaceId)

    const filter: Record<string, unknown> = {
        ...buildListFilter(userId, type, workspaceId, tags),
        $or: [
            { title: { $regex: regex } },
            { description: { $regex: regex } },
            { source: { $regex: regex } },
            { paymentMethod: { $regex: regex } },
            { tags: { $regex: regex } },
            ...(numericKeyword !== null ? [{ amount: numericKeyword }] : []),
        ],
    }

    if (sortBy === 'category') {
        const results = await Transaction.aggregate([
            { $match: filter },
            ...buildCategorySortLookupStages(userId),
            { $sort: buildTransactionSort(sortBy as string, sortOrder as string) },
            STRIP_CATEGORY_SORT_JOIN,
        ]).option({ [RLS_ALLOW_LOOKUP]: true })

        return attachTransferDirections(
            await enrichTransactionsForWorkspace(
                workspaceId,
                results.map((doc) => serializeTransactionPlain(doc))
            )
        )
    }

    const sort = buildTransactionSort(sortBy as string | undefined, sortOrder as string | undefined)
    const transactions = await Transaction.find(filter).sort(sort)
    return attachTransferDirections(
        await enrichTransactionsForWorkspace(workspaceId, serializeTransactions(transactions))
    )
}

const HIDDEN_CATEGORY_LABEL = 'Other'

const loadVisibleCategoryNames = async (userId: string): Promise<Map<string, string>> => {
    const categories = await Category.find({
        userId: { $in: [new Types.ObjectId(userId), null] },
    })
        .select('name')
        .lean()
    return new Map(categories.map((category) => [category._id.toString(), category.name]))
}

const categoryNameResolver =
    (names: Map<string, string>) =>
    (categoryId: unknown): string =>
        categoryId ? (names.get(String(categoryId)) ?? HIDDEN_CATEGORY_LABEL) : ''

export type DownloadResult =
    | { kind: 'csv'; rows: AsyncGenerator<string[]> }
    | {
          kind: 'file'
          format: Exclude<ReturnType<typeof parseExportFormat>, 'csv'>
          payload: {
              exportedAt: string
              filters: { type: string; startDate?: string; endDate?: string }
              count: number
              transactions: ReturnType<typeof buildTransactionExportRecord>[]
          }
      }

export const buildTransactionDownload = async (input: QueryInput): Promise<DownloadResult> => {
    const { userId, query, timezone } = input
    const { type, startDate, endDate, format: formatParam } = query
    const workspaceId = await resolveListWorkspaceId(userId, input.workspaceId)

    const exportType = parseTransactionExportType(type)
    let filter: Record<string, unknown>

    if (exportType === 'both') {
        filter = {
            ...buildScopedListFilter(userId, workspaceId),
            ...LISTABLE_TRANSACTION_FILTER,
            type: { $in: ['income', 'expense'] },
        }
    } else if (exportType) {
        filter = buildListFilter(userId, exportType, workspaceId)
    } else {
        filter = buildListFilter(userId, type, workspaceId)
    }

    if (startDate || endDate) {
        validateRequiredFields({ startDate, endDate }, ['startDate', 'endDate'])
        const dateRange = resolveRange(startDate, endDate, timezone)
        filter.date = { $gte: dateRange.start, $lte: dateRange.end }
    }

    const format = parseExportFormat(typeof formatParam === 'string' ? formatParam : 'csv')
    const categoryNameOf = categoryNameResolver(await loadVisibleCategoryNames(userId))

    if (format === 'csv') {
        const cursor = Transaction.find(filter).sort({ date: -1 }).cursor()

        async function* rows(): AsyncGenerator<string[]> {
            for await (const transaction of cursor) {
                yield formatTransactionCsvRow(
                    serializeTransaction(transaction),
                    categoryNameOf(transaction.categoryId)
                )
            }
        }

        return { kind: 'csv', rows: rows() }
    }

    const transactions = await Transaction.find(filter).sort({ date: -1 })

    const records = transactions.map((transaction) =>
        buildTransactionExportRecord(
            serializeTransaction(transaction),
            categoryNameOf(transaction.categoryId)
        )
    )

    const typeLabel =
        exportType ??
        (typeof type === 'string' && type.trim() !== ''
            ? String(type).trim().toLowerCase()
            : 'all')

    return {
        kind: 'file',
        format: format as Exclude<ReturnType<typeof parseExportFormat>, 'csv'>,
        payload: {
            exportedAt: new Date().toISOString(),
            filters: {
                type: typeLabel,
                startDate: typeof startDate === 'string' ? startDate : undefined,
                endDate: typeof endDate === 'string' ? endDate : undefined,
            },
            count: records.length,
            transactions: records,
        },
    }
}
