import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { DEFAULT_TIMEZONE, resolveDateRange } from '../utils/timezoneUtils'
import {
    adjustAccountForTransactionChange,
    applyTransactionToAccount,
    buildCsvString,
    buildTransactionSort,
    CSV_HEADERS,
    duplicateTransactionFields,
    formatTransactionCsvRow,
    getUserId,
    handleResponses,
    parseClientAmount,
    reverseTransactionOnAccount,
    serializeTransaction,
    serializeTransactionPlain,
    serializeTransactions,
    Transaction,
    validateAccountForTransaction,
    validateCategoryForTransaction,
    validateOwnership,
    validateRequiredFields,
    buildSearchRegex,
} from '../utils/transactionUtils'
import { TRANSACTION_TYPES } from '../models/Transaction'

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

const buildListFilter = (userId: string, type?: unknown) => {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) }

    if (type !== undefined && type !== '') {
        if (!TRANSACTION_TYPES.includes(type as (typeof TRANSACTION_TYPES)[number])) {
            throw new CustomError(
                `Invalid type filter. Must be one of: ${TRANSACTION_TYPES.join(', ')}`,
                400
            )
        }
        filter.type = type
    }

    return filter
}

export const createTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    validateRequiredFields(req.body, ['type', 'title', 'amount', 'date', 'accountId', 'categoryId'])

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
    } = req.body

    if (!SUPPORTED_CREATE_TYPES.includes(type)) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.UNSUPPORTED_TYPE, 400)
    }

    if (isNaN(Date.parse(date))) {
        throw new CustomError('Invalid date format', 400)
    }

    const amountMinor = parseClientAmount(amount)
    const account = await validateAccountForTransaction(accountId, userId)
    await validateCategoryForTransaction(categoryId, userId)

    const transaction = await Transaction.create({
        userId,
        workspaceId: workspaceId ?? null,
        accountId,
        categoryId,
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

    handleResponses(res, 201, serializeTransaction(transaction))
})

export const getTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { type, sortBy, sortOrder } = req.query
    const { pageNumber, limitNumber } = parsePagination(req.query.page, req.query.limit)
    const filter = buildListFilter(userId, type)

    if (sortBy === 'category') {
        const sort = buildTransactionSort(sortBy as string, sortOrder as string)
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
                { $sort: sort },
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

    const transaction = await validateOwnership(
        Transaction,
        transactionId,
        userId,
        ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND
    )

    handleResponses(res, 200, serializeTransaction(transaction))
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

    const transaction = await validateOwnership(
        Transaction,
        transactionId,
        userId,
        ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND
    )

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
    handleResponses(res, 200, serializeTransaction(transaction))
})

export const deleteTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { transactionId } = req.params

    validateRequiredFields({ transactionId }, ['transactionId'])

    const transaction = await validateOwnership(
        Transaction,
        transactionId,
        userId,
        ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND
    )

    const account = await validateAccountForTransaction(
        transaction.accountId.toString(),
        userId
    )

    await reverseTransactionOnAccount(account, transaction.type, transaction.amount)
    await Transaction.deleteOne({ _id: transactionId })

    handleResponses(res, 200, { message: 'Transaction deleted successfully' })
})

export const filterTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { startDate, endDate, type, sortBy, sortOrder } = req.query
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

    const filter = {
        ...buildListFilter(userId, type),
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
    const { keyword, type, sortBy, sortOrder } = req.query

    validateRequiredFields({ keyword }, ['keyword'])

    const regex = buildSearchRegex(keyword as string)
    const numericKeyword = !isNaN(Number(keyword)) ? parseClientAmount(keyword) : null

    const filter: Record<string, unknown> = {
        ...buildListFilter(userId, type),
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
    const { type } = req.query
    const filter = buildListFilter(userId, type)

    const transactions = await Transaction.find(filter)
        .populate('categoryId', 'name')
        .sort({ date: -1 })

    const rows = [
        CSV_HEADERS,
        ...transactions.map((transaction) => {
            const serialized = serializeTransaction(transaction)
            const categoryName =
                typeof transaction.categoryId === 'object' &&
                transaction.categoryId !== null &&
                'name' in transaction.categoryId
                    ? String((transaction.categoryId as { name: string }).name)
                    : ''
            return formatTransactionCsvRow(serialized, categoryName)
        }),
    ]

    const csvString = buildCsvString(rows)

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename=transactions.csv')
    res.status(200).send(csvString)
})

export const duplicateTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { transactionId } = req.params

    validateRequiredFields({ transactionId }, ['transactionId'])

    const transaction = await validateOwnership(
        Transaction,
        transactionId,
        userId,
        ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND
    )

    const account = await validateAccountForTransaction(
        transaction.accountId.toString(),
        userId
    )

    const duplicate = await Transaction.create(duplicateTransactionFields(transaction))
    await applyTransactionToAccount(account, duplicate.type, duplicate.amount)

    handleResponses(res, 201, serializeTransaction(duplicate))
})
