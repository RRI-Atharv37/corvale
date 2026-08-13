import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { DEFAULT_TIMEZONE, resolveDateRange } from '../utils/timezoneUtils'
import { evaluateBudgetOverLimitNotifications } from '../utils/notificationUtils'
import {
    adjustAccountForTransactionChange,
    applyTransactionToAccount,
    applyTransferToAccounts,
    assertEditableTransaction,
    buildTransactionSort,
    deleteTransactionForUser,
    duplicateTransactionFields,
    fetchSplitChildren,
    getOtherMasterCategoryId,
    getUserId,
    handleResponses,
    isSplitChild,
    isTransferLeg,
    LISTABLE_TRANSACTION_FILTER,
    parseClientAmount,
    serializeTransaction,
    serializeTransactionPlain,
    serializeTransactions,
    serializeTransactionWithSplits,
    SplitInput,
    Transaction,
    validateAccountForTransaction,
    validateCategoryForTransaction,
    validateOwnership,
    validateRequiredFields,
    validateSplitInputs,
    buildSearchRegex,
} from '../utils/transactionUtils'
import {
    buildTransactionExportRecord,
    parseExportFormat,
    parseTransactionExportType,
    sendTransactionExport,
} from '../utils/exportUtils'
import { validateReceiptOwnership } from '../utils/receiptUtils'
import { TRANSACTION_TYPES, ITransaction } from '../models/Transaction'
import {
    assertAccountMatchesWorkspace,
    assertWorkspaceMembership,
    buildScopedListFilter,
    parseOptionalWorkspaceId,
    validateResourceAccess,
} from '../utils/workspaceUtils'
import { buildTagFilter, parseTagsQuery } from '../utils/tagUtils'

const SUPPORTED_CREATE_TYPES = ['income', 'expense'] as const

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
    tags?: unknown
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

const createSplitChildren = async (
    userId: string,
    parentId: Types.ObjectId,
    accountId: Types.ObjectId,
    currency: string,
    title: string,
    date: Date,
    status: string,
    workspaceId: unknown,
    splits: SplitInput[],
    parentAmountMinor: number,
    paymentMethod?: string,
    tags?: string[],
    description?: string
) => {
    const normalizedSplits = validateSplitInputs(splits, parentAmountMinor)

    for (const split of normalizedSplits) {
        await validateCategoryForTransaction(split.categoryId, userId)
    }

    await Transaction.insertMany(
        normalizedSplits.map((split) => ({
            userId,
            workspaceId: workspaceId ?? null,
            accountId,
            categoryId: split.categoryId,
            type: 'expense',
            status,
            amount: split.amount,
            currency,
            title,
            description: description?.trim(),
            date,
            paymentMethod: paymentMethod?.trim(),
            tags,
            splitTransactionId: parentId,
        }))
    )
}

export const createTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    validateRequiredFields(req.body, ['type', 'title', 'amount', 'date', 'accountId'])

    const {
        type,
        title,
        amount,
        date,
        accountId,
        categoryId,
        description,
        source,
        paymentMethod,
        tags,
        status,
        workspaceId,
        splits,
    } = req.body

    if (!SUPPORTED_CREATE_TYPES.includes(type)) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.UNSUPPORTED_TYPE, 400)
    }

    if (isNaN(Date.parse(date))) {
        throw new CustomError('Invalid date format', 400)
    }

    const amountMinor = parseClientAmount(amount)
    const resolvedWorkspaceId = parseOptionalWorkspaceId(workspaceId) ?? null

    if (resolvedWorkspaceId) {
        await assertWorkspaceMembership(resolvedWorkspaceId, userId, 'editor')
    }

    const account = await validateAccountForTransaction(accountId, userId)
    assertAccountMatchesWorkspace(account.workspaceId, resolvedWorkspaceId)
    const hasSplits = Array.isArray(splits) && splits.length > 0

    if (hasSplits) {
        if (type !== 'expense') {
            throw new CustomError(ERROR_MESSAGES.TRANSACTION.SPLIT_REQUIRES_EXPENSE, 400)
        }
        validateSplitInputs(splits, amountMinor)
    } else {
        validateRequiredFields(req.body, ['categoryId'])
        await validateCategoryForTransaction(categoryId, userId)
    }

    const resolvedCategoryId = hasSplits ? splits[0].categoryId : categoryId
    if (hasSplits) {
        await validateCategoryForTransaction(resolvedCategoryId, userId)
    }

    const transaction = await Transaction.create({
        userId,
        workspaceId: resolvedWorkspaceId,
        accountId,
        categoryId: resolvedCategoryId,
        type,
        status: status ?? 'posted',
        amount: amountMinor,
        currency: account.currency,
        title: title.trim(),
        description: description?.trim(),
        date: new Date(date),
        source: source?.trim(),
        paymentMethod: paymentMethod?.trim(),
        tags,
    })

    await applyTransactionToAccount(account, type, amountMinor)

    if (hasSplits) {
        await createSplitChildren(
            userId,
            transaction._id,
            transaction.accountId,
            transaction.currency,
            transaction.title,
            transaction.date,
            transaction.status,
            resolvedWorkspaceId,
            splits,
            amountMinor,
            paymentMethod,
            tags,
            description
        )
    }

    const payload = await serializeTransactionWithSplits(transaction, userId)
    await evaluateBudgetOverLimitNotifications(userId, transaction)
    handleResponses(res, 201, payload)
})

export const createTransfer = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    validateRequiredFields(req.body, ['title', 'amount', 'date', 'fromAccountId', 'toAccountId'])

    const { title, amount, date, fromAccountId, toAccountId, description, status, workspaceId } =
        req.body

    if (fromAccountId === toAccountId) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.SAME_TRANSFER_ACCOUNT, 400)
    }

    if (isNaN(Date.parse(date))) {
        throw new CustomError('Invalid date format', 400)
    }

    const amountMinor = parseClientAmount(amount)
    const resolvedWorkspaceId = parseOptionalWorkspaceId(workspaceId) ?? null

    if (resolvedWorkspaceId) {
        await assertWorkspaceMembership(resolvedWorkspaceId, userId, 'editor')
    }

    const fromAccount = await validateAccountForTransaction(fromAccountId, userId)
    const toAccount = await validateAccountForTransaction(toAccountId, userId)
    assertAccountMatchesWorkspace(fromAccount.workspaceId, resolvedWorkspaceId)
    assertAccountMatchesWorkspace(toAccount.workspaceId, resolvedWorkspaceId)

    if (fromAccount.currency !== toAccount.currency) {
        throw new CustomError('Transfer accounts must use the same currency', 400)
    }

    const transferCategoryId = await getOtherMasterCategoryId()
    const parsedDate = new Date(date)
    const trimmedTitle = title.trim()
    const trimmedDescription = description?.trim()

    const result = await (async () => {
        let outbound: ITransaction | null = null
        let inbound: ITransaction | null = null

        try {
            outbound = await Transaction.create({
                userId,
                workspaceId: resolvedWorkspaceId,
                accountId: fromAccountId,
                categoryId: transferCategoryId,
                type: 'transfer',
                status: status ?? 'posted',
                amount: amountMinor,
                currency: fromAccount.currency,
                title: trimmedTitle,
                description: trimmedDescription,
                date: parsedDate,
            })

            inbound = await Transaction.create({
                userId,
                workspaceId: resolvedWorkspaceId,
                accountId: toAccountId,
                categoryId: transferCategoryId,
                type: 'transfer',
                status: status ?? 'posted',
                amount: amountMinor,
                currency: toAccount.currency,
                title: trimmedTitle,
                description: trimmedDescription,
                date: parsedDate,
                transferPairId: outbound._id,
            })

            outbound.transferPairId = inbound._id
            await outbound.save()

            await applyTransferToAccounts(fromAccount, toAccount, amountMinor)

            return { outbound, inbound }
        } catch (error) {
            if (inbound) {
                await Transaction.deleteOne({ _id: inbound._id })
            }
            if (outbound) {
                await Transaction.deleteOne({ _id: outbound._id })
            }
            throw error
        }
    })()

    handleResponses(res, 201, {
        outbound: serializeTransaction(result.outbound),
        inbound: serializeTransaction(result.inbound),
    })
})

export const getTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { type, sortBy, sortOrder, tags } = req.query
    const { pageNumber, limitNumber } = parsePagination(req.query.page, req.query.limit)
    const workspaceId = await resolveListWorkspaceId(req)
    const filter = buildListFilter(userId, type, workspaceId, tags)

    if (sortBy === 'category') {
        const [results, totalCount] = await Promise.all([
            Transaction.aggregate([
                { $match: filter },
                {
                    $lookup: {
                        from: 'categories',
                        localField: 'categoryId',
                        foreignField: '_id',
                        as: 'category',
                    },
                },
                { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
                { $sort: buildTransactionSort(sortBy as string, sortOrder as string) },
                { $skip: (pageNumber - 1) * limitNumber },
                { $limit: limitNumber },
            ]),
            Transaction.countDocuments(filter),
        ])

        const data = results.map((doc) => serializeTransactionPlain(doc))

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
        data: serializeTransactions(transactions),
        meta: {
            totalTransactions,
            pageNumber,
            totalPages: Math.ceil(totalTransactions / limitNumber),
            limit: limitNumber,
        },
    })
})

export const getTransactionById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { transactionId } = req.params

    validateRequiredFields({ transactionId }, ['transactionId'])

    const transaction = await validateResourceAccess(
        Transaction,
        transactionId,
        userId,
        ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
        'viewer'
    )

    const payload = await serializeTransactionWithSplits(transaction, userId)

    if (isTransferLeg(transaction) && transaction.transferPairId) {
        const pair = await validateResourceAccess(
            Transaction,
            transaction.transferPairId.toString(),
            userId,
            ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
            'viewer'
        )
        payload.transferPair = serializeTransaction(pair)
    }

    handleResponses(res, 200, payload)
})

export const updateTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { transactionId } = req.params
    const {
        title,
        amount,
        description,
        categoryId,
        date,
        accountId,
        type,
        source,
        paymentMethod,
        tags,
        status,
    } = req.body

    validateRequiredFields({ transactionId }, ['transactionId'])

    const transaction = await validateResourceAccess(
        Transaction,
        transactionId,
        userId,
        ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
        'editor'
    )

    assertEditableTransaction(transaction)

    const splitChildren = await fetchSplitChildren(transaction._id, userId)
    if (splitChildren.length > 0) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.SPLIT_NOT_EDITABLE, 400)
    }

    if (type !== undefined && !SUPPORTED_CREATE_TYPES.includes(type)) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.UNSUPPORTED_TYPE, 400)
    }

    const nextType = type ?? transaction.type
    const nextAmountMinor =
        amount !== undefined ? parseClientAmount(amount) : transaction.amount
    const nextAccountId = accountId ?? transaction.accountId.toString()

    if (accountId !== undefined) {
        await validateAccountForTransaction(accountId, userId)
    }
    if (categoryId !== undefined) {
        await validateCategoryForTransaction(categoryId, userId)
    }

    const balanceChanged =
        nextType !== transaction.type ||
        nextAmountMinor !== transaction.amount ||
        nextAccountId !== transaction.accountId.toString()

    if (balanceChanged) {
        await adjustAccountForTransactionChange(
            transaction,
            nextType,
            nextAmountMinor,
            nextAccountId
        )
    }

    if (title !== undefined) transaction.title = title.trim()
    if (amount !== undefined) transaction.amount = nextAmountMinor
    if (description !== undefined) transaction.description = description.trim() || undefined
    if (categoryId !== undefined) transaction.categoryId = categoryId
    if (date !== undefined) {
        if (isNaN(Date.parse(date))) {
            throw new CustomError('Invalid date format', 400)
        }
        transaction.date = new Date(date)
    }
    if (accountId !== undefined) {
        const account = await validateAccountForTransaction(accountId, userId)
        transaction.accountId = accountId
        transaction.currency = account.currency
    }
    if (type !== undefined) transaction.type = type
    if (source !== undefined) transaction.source = source.trim() || undefined
    if (paymentMethod !== undefined) transaction.paymentMethod = paymentMethod.trim() || undefined
    if (tags !== undefined) transaction.tags = tags
    if (status !== undefined) transaction.status = status

    await transaction.save()
    await evaluateBudgetOverLimitNotifications(userId, transaction)
    handleResponses(res, 200, serializeTransaction(transaction))
})

export const deleteTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { transactionId } = req.params

    validateRequiredFields({ transactionId }, ['transactionId'])

    const transaction = await validateResourceAccess(
        Transaction,
        transactionId,
        userId,
        ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
        'editor'
    )

    await deleteTransactionForUser(userId, transaction)

    handleResponses(res, 200, {
        message:
            isTransferLeg(transaction) && transaction.transferPairId
                ? 'Transfer deleted successfully'
                : 'Transaction deleted successfully',
    })
})

export const filterTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { startDate, endDate, type, sortBy, sortOrder, tags } = req.query
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
        ...buildListFilter(userId, type, workspaceId, tags),
        date: { $gte: dateRange.start, $lte: dateRange.end },
    }

    if (sortBy === 'category') {
        const sort = buildTransactionSort(sortBy as string, sortOrder as string)
        const results = await Transaction.aggregate([
            { $match: filter },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'category',
                },
            },
            { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
            { $sort: sort },
        ])

        const data = results.map((doc) => serializeTransactionPlain(doc))

        handleResponses(res, 200, data)
        return
    }

    const sort = buildTransactionSort(sortBy as string | undefined, sortOrder as string | undefined)
    const transactions = await Transaction.find(filter).sort(sort)

    handleResponses(res, 200, serializeTransactions(transactions))
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
            {
                $lookup: {
                    from: 'categories',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'category',
                },
            },
            { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
            { $sort: sort },
        ])

        const data = results.map((doc) => serializeTransactionPlain(doc))

        handleResponses(res, 200, data)
        return
    }

    const sort = buildTransactionSort(sortBy as string | undefined, sortOrder as string | undefined)
    const transactions = await Transaction.find(filter).sort(sort)

    handleResponses(res, 200, serializeTransactions(transactions))
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

    const format = parseExportFormat(typeof formatParam === 'string' ? formatParam : 'csv')
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

export const duplicateTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { transactionId } = req.params

    validateRequiredFields({ transactionId }, ['transactionId'])

    const transaction = await validateResourceAccess(
        Transaction,
        transactionId,
        userId,
        ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
        'editor'
    )

    assertEditableTransaction(transaction)

    const splitChildren = await fetchSplitChildren(transaction._id, userId)
    if (splitChildren.length > 0) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.SPLIT_NOT_EDITABLE, 400)
    }

    const account = await validateAccountForTransaction(
        transaction.accountId.toString(),
        userId
    )

    const duplicate = await Transaction.create(duplicateTransactionFields(transaction))
    await applyTransactionToAccount(account, duplicate.type, duplicate.amount)

    handleResponses(res, 201, serializeTransaction(duplicate))
})

export const attachReceiptToTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { transactionId } = req.params
    const { receiptId } = req.body

    validateRequiredFields({ transactionId, receiptId }, ['transactionId', 'receiptId'])

    const [transaction, receipt] = await Promise.all([
        validateResourceAccess(
            Transaction,
            transactionId,
            userId,
            ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
            'editor'
        ),
        validateReceiptOwnership(receiptId, userId),
    ])

    if (isSplitChild(transaction)) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.SPLIT_NOT_EDITABLE, 400)
    }

    const existingIds = transaction.receiptIds?.map((id) => id.toString()) ?? []
    if (existingIds.includes(receipt._id.toString())) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.RECEIPT_ALREADY_ATTACHED, 400)
    }

    transaction.receiptIds = [...(transaction.receiptIds ?? []), receipt._id]
    await transaction.save()

    const payload = await serializeTransactionWithSplits(transaction, userId)
    handleResponses(res, 200, payload)
})

export const detachReceiptFromTransaction = asyncHandler(
    async (req: AuthRequest, res: Response) => {
        const userId = getUserId(req)
        const { transactionId, receiptId } = req.params

        validateRequiredFields({ transactionId, receiptId }, ['transactionId', 'receiptId'])

        const transaction = await validateResourceAccess(
            Transaction,
            transactionId,
            userId,
            ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
            'editor'
        )

        if (isSplitChild(transaction)) {
            throw new CustomError(ERROR_MESSAGES.TRANSACTION.SPLIT_NOT_EDITABLE, 400)
        }

        const existingIds = transaction.receiptIds?.map((id) => id.toString()) ?? []
        if (!existingIds.includes(receiptId)) {
            throw new CustomError(ERROR_MESSAGES.TRANSACTION.RECEIPT_NOT_ATTACHED, 400)
        }

        transaction.receiptIds = transaction.receiptIds?.filter(
            (id) => id.toString() !== receiptId
        )
        await transaction.save()

        const payload = await serializeTransactionWithSplits(transaction, userId)
        handleResponses(res, 200, payload)
    }
)

const parseBulkTransactionIds = (transactionIds: unknown): string[] => {
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.BULK_EMPTY, 400)
    }

    const uniqueIds = [...new Set(transactionIds.map((id) => String(id).trim()).filter(Boolean))]
    if (uniqueIds.length === 0) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.BULK_EMPTY, 400)
    }

    return uniqueIds
}

export const bulkDeleteTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const transactionIds = parseBulkTransactionIds(req.body.transactionIds)

    const processedTransferPairs = new Set<string>()
    let deletedCount = 0

    for (const transactionId of transactionIds) {
        const transaction = await Transaction.findById(transactionId)

        if (!transaction) {
            const deletedAsTransferPair = [...processedTransferPairs].some((pairKey) =>
                pairKey.split(':').includes(transactionId)
            )
            if (deletedAsTransferPair) {
                deletedCount += 1
                continue
            }
            throw new CustomError(ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND, 404)
        }

        await validateResourceAccess(
            Transaction,
            transactionId,
            userId,
            ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
            'editor'
        )

        if (isTransferLeg(transaction) && transaction.transferPairId) {
            const pairKey = [transaction._id.toString(), transaction.transferPairId.toString()]
                .sort()
                .join(':')
            if (processedTransferPairs.has(pairKey)) {
                deletedCount += 1
                continue
            }
            processedTransferPairs.add(pairKey)
        }

        await deleteTransactionForUser(userId, transaction)
        deletedCount += 1
    }

    handleResponses(res, 200, {
        message: `${deletedCount} transaction${deletedCount === 1 ? '' : 's'} deleted`,
        deletedCount,
    })
})

export const bulkUpdateTransactionCategory = asyncHandler(
    async (req: AuthRequest, res: Response) => {
        const userId = getUserId(req)
        const { categoryId } = req.body
        const transactionIds = parseBulkTransactionIds(req.body.transactionIds)

        validateRequiredFields({ categoryId }, ['categoryId'])
        await validateCategoryForTransaction(categoryId, userId)

        const transactions = await Promise.all(
            transactionIds.map((transactionId) =>
                validateResourceAccess(
                    Transaction,
                    transactionId,
                    userId,
                    ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
                    'editor'
                )
            )
        )

        for (const transaction of transactions) {
            if (transaction.type === 'transfer') {
                throw new CustomError(ERROR_MESSAGES.TRANSACTION.BULK_CATEGORY_TRANSFER, 400)
            }
            if (isSplitChild(transaction)) {
                throw new CustomError(ERROR_MESSAGES.TRANSACTION.SPLIT_NOT_EDITABLE, 400)
            }
        }

        const workspaceId = transactions[0]?.workspaceId ?? null
        const hasMixedWorkspaceScope = transactions.some(
            (transaction) => (transaction.workspaceId?.toString() ?? null) !== (workspaceId?.toString() ?? null)
        )
        if (hasMixedWorkspaceScope) {
            throw new CustomError(ERROR_MESSAGES.TRANSACTION.BULK_EMPTY, 400)
        }

        const updateFilter: Record<string, unknown> = {
            _id: { $in: transactions.map((transaction) => transaction._id) },
        }
        if (workspaceId) {
            updateFilter.workspaceId = workspaceId
        } else {
            updateFilter.userId = new Types.ObjectId(userId)
            updateFilter.workspaceId = null
        }

        await Transaction.updateMany(updateFilter, { $set: { categoryId } })

        handleResponses(res, 200, {
            message: `${transactions.length} transaction${transactions.length === 1 ? '' : 's'} updated`,
            updatedCount: transactions.length,
        })
    }
)
