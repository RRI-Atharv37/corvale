import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    adjustAccountForTransactionChange,
    applyTransactionToAccount,
    applyTransferToAccounts,
    assertEditableTransaction,
    deleteTransactionForUser,
    duplicateTransactionFields,
    enrichTransactionForWorkspace,
    enrichTransactionsForWorkspace,
    fetchSplitChildren,
    getOtherMasterCategoryId,
    getUserId,
    handleResponses,
    isSplitChild,
    isTransferLeg,
    parseClientAmount,
    serializeTransaction,
    serializeTransactionWithSplits,
    SerializedTransactionWithSplits,
    Transaction,
    validateAccountForTransaction,
    validateCategoryForTransaction,
    validateRequiredFields,
} from './transactionUtils'
import { ITransaction } from './transaction.model'
import { assertAccountMatchesWorkspace, parseOptionalWorkspaceId } from '@core/access/workspace'
import { createTransactionForUser } from './transaction.service'
import { evaluateBudgetOverLimitNotifications } from '@modules/notifications/notificationUtils'
import { validateReceiptOwnership } from '@modules/receipts/receiptUtils'
import { assertWorkspaceMembership, validateResourceAccess } from '@modules/workspaces/access'

const SUPPORTED_CREATE_TYPES = ['income', 'expense'] as const

export const createTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const payload = await createTransactionForUser(userId, req.body)
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

            await applyTransferToAccounts(fromAccount, toAccount, amountMinor, parsedDate)

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

    const payload: SerializedTransactionWithSplits = await serializeTransactionWithSplits(
        transaction,
        userId
    )

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

    const workspaceId = transaction.workspaceId?.toString() ?? null
    const enriched = await enrichTransactionForWorkspace(workspaceId, payload)

    if (enriched.transferPair) {
        enriched.transferPair = await enrichTransactionForWorkspace(
            workspaceId,
            enriched.transferPair
        )
    }

    if (enriched.splits?.length) {
        enriched.splits = await enrichTransactionsForWorkspace(workspaceId, enriched.splits)
    }

    handleResponses(res, 200, enriched)
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

    if (date !== undefined && isNaN(Date.parse(date))) {
        throw new CustomError('Invalid date format', 400)
    }
    const nextDate = date !== undefined ? new Date(date) : transaction.date

    const transactionWorkspaceId = transaction.workspaceId?.toString() ?? null
    if (accountId !== undefined) {
        const account = await validateAccountForTransaction(accountId, userId)
        assertAccountMatchesWorkspace(account.workspaceId, transactionWorkspaceId)
    }
    if (categoryId !== undefined) {
        await validateCategoryForTransaction(categoryId, userId)
    }

    // A date change matters to the running balance too: moving a transaction
    // across an account's openingBalanceDate adds or drops its delta. For an
    // account with no openingBalanceDate the reverse+re-apply nets to zero.
    const dateChanged = nextDate.getTime() !== transaction.date.getTime()
    const balanceChanged =
        nextType !== transaction.type ||
        nextAmountMinor !== transaction.amount ||
        nextAccountId !== transaction.accountId.toString() ||
        dateChanged

    if (balanceChanged) {
        await adjustAccountForTransactionChange(
            transaction,
            nextType,
            nextAmountMinor,
            nextAccountId,
            nextDate
        )
    }

    if (title !== undefined) transaction.title = title.trim()
    if (amount !== undefined) transaction.amount = nextAmountMinor
    if (description !== undefined) transaction.description = description.trim() || undefined
    if (categoryId !== undefined) transaction.categoryId = categoryId
    if (date !== undefined) transaction.date = nextDate
    if (accountId !== undefined) {
        const account = await validateAccountForTransaction(accountId, userId)
        assertAccountMatchesWorkspace(account.workspaceId, transactionWorkspaceId)
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

    const duplicate = await Transaction.create(duplicateTransactionFields(transaction, userId))
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
