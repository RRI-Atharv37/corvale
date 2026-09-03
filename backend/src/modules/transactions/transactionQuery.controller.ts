import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { DEFAULT_TIMEZONE, resolveDateRange } from '@core/time/timezoneUtils'
import {
    buildCategorySortLookupStages,
    buildTransactionSort,
    CSV_HEADERS,
    enrichTransactionsForWorkspace,
    formatTransactionCsvRow,
    getUserId,
    handleResponses,
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
    sendTransactionExport,
    streamCsvExport,
} from './export'
import { TRANSACTION_TYPES, CLEARED_STATUSES, TRANSACTION_STATUSES } from './transaction.model'
import { buildScopedListFilter, parseOptionalWorkspaceId } from '@core/access/workspace'
import { RLS_ALLOW_LOOKUP } from '@core/access/rowLevelSecurity'
import { buildTagFilter, parseTagsQuery } from '@modules/tags/tagUtils'
import { assertWorkspaceMembership } from '@modules/workspaces/access'

const getUserTimezone = (req: AuthRequest): string => {
    return req.user?.timezone?.trim() || DEFAULT_TIMEZONE
}

const parsePagination = (page: unknown, limit: unknown) => {
    const pageNumber = Number(page ?? 1)
    const limitNumber = Number(limit ?? 10)

    if (isNaN(pageNumber) || isNaN(limitNumber) || pageNumber < 1 || limitNumber < 1) {
        throw new CustomError('Invalid page or limit number', 400)
    }

    return { pageNumber, limitNumber }
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
        if (!CLEARED_STATUSES.includes(clearedStatus as (typeof CLEARED_STATUSES)[number])) {
            throw new CustomError(
                `Invalid clearedStatus filter. Must be one of: ${CLEARED_STATUSES.join(', ')}`,
                400
            )
        }
        filter.clearedStatus = clearedStatus
    }

    if (accountId !== undefined && accountId !== '') {
        // req.query is not covered by the app-level sanitizeBody guard (SEC-35), and the
        // query parser is pinned to 'simple' so this is always a primitive — validate it
        // as an ObjectId before it reaches the Mongoose filter. accountId is compared
        // against an ObjectId column, so a non-ObjectId value is meaningless anyway.
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

const resolveListWorkspaceId = async (req: AuthRequest): Promise<string | null> => {
    const userId = getUserId(req)
    const workspaceId = parseOptionalWorkspaceId(req.query.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'viewer')
    }

    return workspaceId
}

export const getTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { type, sortBy, sortOrder, tags, clearedStatus, accountId, status } = req.query
    const { pageNumber, limitNumber } = parsePagination(req.query.page, req.query.limit)
    const workspaceId = await resolveListWorkspaceId(req)
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

        const data = await enrichTransactionsForWorkspace(
            workspaceId,
            results.map((doc) => serializeTransactionPlain(doc))
        )

        handleResponses(res, 200, {
            data,
            meta: {
                totalTransactions: totalCount,
                pageNumber,
                totalPages: Math.ceil(totalCount / limitNumber),
                limit: limitNumber,
            },
        })
        return
    }

    const sort = buildTransactionSort(sortBy as string | undefined, sortOrder as string | undefined)
    const [transactions, totalTransactions] = await Promise.all([
        Transaction.find(filter)
            .sort(sort)
            .skip((pageNumber - 1) * limitNumber)
            .limit(limitNumber),
        Transaction.countDocuments(filter),
    ])

    handleResponses(res, 200, {
        data: await enrichTransactionsForWorkspace(workspaceId, serializeTransactions(transactions)),
        meta: {
            totalTransactions,
            pageNumber,
            totalPages: Math.ceil(totalTransactions / limitNumber),
            limit: limitNumber,
        },
    })
})

export const filterTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { startDate, endDate, type, sortBy, sortOrder, tags, clearedStatus, status } = req.query
    const timezone = getUserTimezone(req)

    validateRequiredFields({ startDate, endDate }, ['startDate', 'endDate'])

    let dateRange: { start: Date; end: Date }
    try {
        dateRange = resolveDateRange(startDate as string, endDate as string, timezone)
    } catch (error) {
        throw new CustomError(
            error instanceof Error ? error.message : 'Invalid date range',
            400
        )
    }

    const workspaceId = await resolveListWorkspaceId(req)

    const filter = {
        ...buildListFilter(userId, type, workspaceId, tags, clearedStatus, undefined, status),
        date: { $gte: dateRange.start, $lte: dateRange.end },
    }

    if (sortBy === 'category') {
        const sort = buildTransactionSort(sortBy as string, sortOrder as string)
        const results = await Transaction.aggregate([
            { $match: filter },
            ...buildCategorySortLookupStages(userId),
            { $sort: sort },
            STRIP_CATEGORY_SORT_JOIN,
        ]).option({ [RLS_ALLOW_LOOKUP]: true })

        const data = await enrichTransactionsForWorkspace(
            workspaceId,
            results.map((doc) => serializeTransactionPlain(doc))
        )

        handleResponses(res, 200, data)
        return
    }

    const sort = buildTransactionSort(sortBy as string | undefined, sortOrder as string | undefined)
    const transactions = await Transaction.find(filter).sort(sort)

    handleResponses(
        res,
        200,
        await enrichTransactionsForWorkspace(workspaceId, serializeTransactions(transactions))
    )
})

export const searchTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { keyword, type, sortBy, sortOrder, tags } = req.query

    validateRequiredFields({ keyword }, ['keyword'])

    const regex = buildSearchRegex(keyword as string)
    const numericKeyword = !isNaN(Number(keyword)) ? parseClientAmount(keyword) : null
    const workspaceId = await resolveListWorkspaceId(req)

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
        const sort = buildTransactionSort(sortBy as string, sortOrder as string)
        const results = await Transaction.aggregate([
            { $match: filter },
            ...buildCategorySortLookupStages(userId),
            { $sort: sort },
            STRIP_CATEGORY_SORT_JOIN,
        ]).option({ [RLS_ALLOW_LOOKUP]: true })

        const data = await enrichTransactionsForWorkspace(
            workspaceId,
            results.map((doc) => serializeTransactionPlain(doc))
        )

        handleResponses(res, 200, data)
        return
    }

    const sort = buildTransactionSort(sortBy as string | undefined, sortOrder as string | undefined)
    const transactions = await Transaction.find(filter).sort(sort)

    handleResponses(
        res,
        200,
        await enrichTransactionsForWorkspace(workspaceId, serializeTransactions(transactions))
    )
})

export const downloadTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { type, startDate, endDate, format: formatParam } = req.query
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)

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

        let dateRange: { start: Date; end: Date }
        try {
            dateRange = resolveDateRange(startDate as string, endDate as string, timezone)
        } catch (error) {
            throw new CustomError(
                error instanceof Error ? error.message : 'Invalid date range',
                400
            )
        }

        filter.date = { $gte: dateRange.start, $lte: dateRange.end }
    }

    const format = parseExportFormat(typeof formatParam === 'string' ? formatParam : 'csv')

    if (format === 'csv') {
        const cursor = Transaction.find(filter)
            .populate('categoryId', 'name')
            .sort({ date: -1 })
            .cursor()

        async function* csvRows() {
            for await (const transaction of cursor) {
                const serialized = serializeTransaction(transaction)
                const categoryName =
                    typeof transaction.categoryId === 'object' &&
                    transaction.categoryId !== null &&
                    'name' in transaction.categoryId
                        ? String((transaction.categoryId as { name: string }).name)
                        : ''
                yield formatTransactionCsvRow(serialized, categoryName)
            }
        }

        await streamCsvExport(res, 'transactions', CSV_HEADERS, csvRows())
        return
    }

    const transactions = await Transaction.find(filter)
        .populate('categoryId', 'name')
        .sort({ date: -1 })

    const records = transactions.map((transaction) => {
        const serialized = serializeTransaction(transaction)
        const categoryName =
            typeof transaction.categoryId === 'object' &&
            transaction.categoryId !== null &&
            'name' in transaction.categoryId
                ? String((transaction.categoryId as { name: string }).name)
                : ''
        return buildTransactionExportRecord(serialized, categoryName)
    })

    const typeLabel =
        exportType ??
        (typeof type === 'string' && type.trim() !== '' ? String(type).trim().toLowerCase() : 'all')

    sendTransactionExport(res, format, 'transactions', {
        exportedAt: new Date().toISOString(),
        filters: {
            type: typeLabel,
            startDate: typeof startDate === 'string' ? startDate : undefined,
            endDate: typeof endDate === 'string' ? endDate : undefined,
        },
        count: records.length,
        transactions: records,
    })
})
