import { Types } from 'mongoose'

import { ITransaction, TransactionStatus } from './transaction.model'
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
    isSplitChild,
    isTransferLeg,
    parseClientAmount,
    serializeTransaction,
    serializeTransactionWithSplits,
    SerializedTransactionWithSplits,
    SplitInput,
    Transaction,
    validateAccountForTransaction,
    validateCategoryForTransaction,
    validateRequiredFields,
    validateSplitInputs,
} from './transactionUtils'
import { assertAccountMatchesWorkspace, parseOptionalWorkspaceId } from '@core/access/workspace'
import { isDuplicateKeyError, resolveClientObjectId } from '@core/db/objectId'
import { evaluateBudgetOverLimitNotifications } from "@modules/notifications/notificationUtils";
import { applyCategorizationRules, mergeTags } from "@modules/categorization-rules/categorizationRuleUtils";
import { validateReceiptOwnership } from '@modules/receipts/receiptUtils'
import { assertWorkspaceMembership, validateResourceAccess } from "@modules/workspaces/access";

const SUPPORTED_CREATE_TYPES = ['income', 'expense'] as const

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

/**
 * Core create-transaction logic, extracted from transactionController so it
 * can be reused by both the REST endpoint and POST /sync/push (Sprint 13.2).
 * Pure refactor of the previous controller body — same validation, same
 * categorization-rule and split handling, same account balance side effect.
 */
export const createTransactionForUser = async (
    userId: string,
    body: Record<string, unknown>
): Promise<SerializedTransactionWithSplits> => {
    validateRequiredFields(body, ['type', 'title', 'amount', 'date', 'accountId'])

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
        externalId,
    } = body as {
        type: string
        title: string
        amount: unknown
        date: string
        accountId: string
        categoryId?: string
        description?: string
        source?: string
        paymentMethod?: string
        tags?: string[]
        status?: string
        workspaceId?: unknown
        splits?: SplitInput[]
        externalId?: string
    }

    if (!SUPPORTED_CREATE_TYPES.includes(type as (typeof SUPPORTED_CREATE_TYPES)[number])) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.UNSUPPORTED_TYPE, 400)
    }

    if (isNaN(Date.parse(date))) {
        throw new CustomError('Invalid date format', 400)
    }

    const clientId = resolveClientObjectId(body._id)
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
        validateSplitInputs(splits as SplitInput[], amountMinor)
    } else {
        validateRequiredFields(body, ['categoryId'])
        await validateCategoryForTransaction(categoryId as string, userId)
    }

    const resolvedCategoryId = hasSplits ? (splits as SplitInput[])[0].categoryId : categoryId
    if (hasSplits) {
        await validateCategoryForTransaction(resolvedCategoryId as string, userId)
    }

    let finalCategoryId = resolvedCategoryId
    let finalTags = tags

    if (!hasSplits && type !== 'transfer') {
        const ruleResult = await applyCategorizationRules(userId, {
            title: title.trim(),
            description: description?.trim(),
            amount: amountMinor,
            accountId,
            type,
        })

        if (ruleResult) {
            await validateCategoryForTransaction(ruleResult.categoryId.toString(), userId)
            finalCategoryId = ruleResult.categoryId.toString()
            finalTags = mergeTags(tags, ruleResult.tags)
        }
    }

    let transaction
    try {
        transaction = await Transaction.create({
            ...(clientId ? { _id: clientId } : {}),
            userId,
            workspaceId: resolvedWorkspaceId,
            accountId,
            categoryId: finalCategoryId,
            type,
            status: status ?? 'posted',
            amount: amountMinor,
            currency: account.currency,
            title: title.trim(),
            description: description?.trim(),
            date: new Date(date),
            source: source?.trim(),
            paymentMethod: paymentMethod?.trim(),
            tags: finalTags,
            externalId: typeof externalId === 'string' && externalId.trim() ? externalId.trim() : undefined,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('A transaction with this id already exists', 400)
        }
        throw error
    }

    await applyTransactionToAccount(
        account,
        type as (typeof SUPPORTED_CREATE_TYPES)[number],
        amountMinor,
        transaction.date
    )

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
            splits as SplitInput[],
            amountMinor,
            paymentMethod,
            tags,
            description
        )
    }

    const payload = await serializeTransactionWithSplits(transaction, userId)
    await evaluateBudgetOverLimitNotifications(userId, transaction)
    return payload
}

/**
 * Delete-transaction logic for POST /sync/push.
 *
 * Unlike the REST DELETE endpoint's deleteTransactionForUser, this does NOT
 * incrementally reverse the account balance. Per the "Account balance" architecture
 * decision ("... never a syncable field ... out-of-order
 * offline replay would drift silently with no way to heal it"), an
 * offline-originated delete can arrive out of order relative to other
 * offline mutations, so incremental reversal here is unsafe — this only
 * tombstones the record (and cascades to its transfer-pair/split-children).
 * Balance correctness after a sync session is restored via
 * POST /accounts/:accountId/recompute-balance, not incremental math.
 */
export const deleteTransactionForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<string> => {
    const transactionId = payload._id
    if (typeof transactionId !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

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

    const deletedAt = new Date()

    if (isTransferLeg(transaction) && transaction.transferPairId) {
        await Transaction.updateMany(
            {
                _id: { $in: [transaction._id, transaction.transferPairId] },
                userId: new Types.ObjectId(userId),
            },
            { deletedAt }
        )
        return transaction._id.toString()
    }

    const splitChildren = await fetchSplitChildren(transaction._id, userId)
    if (splitChildren.length > 0) {
        await Transaction.updateMany(
            {
                _id: { $in: splitChildren.map((child) => child._id) },
                userId: new Types.ObjectId(userId),
            },
            { deletedAt }
        )
    }

    await Transaction.updateMany({ _id: transaction._id }, { deletedAt })
    return transaction._id.toString()
}

/**
 * Update-transaction logic for POST /sync/push (Sprint 13.3).
 *
 * Unlike updateTransaction's REST behavior, this never adjusts the account
 * balance incrementally, matching deleteTransactionForOp's rationale above:
 * an offline-originated update can arrive out of order relative to other
 * offline mutations, so incremental reversal/reapplication here is unsafe.
 * Balance correctness is restored via POST /accounts/:accountId/recompute-balance.
 */
export const updateTransactionForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<ITransaction> => {
    const transactionId = payload._id
    if (typeof transactionId !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

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

    const { title, amount, description, categoryId, date, tags, status, paymentMethod, source } =
        payload as {
            title?: string
            amount?: unknown
            description?: string
            categoryId?: string
            date?: string
            tags?: string[]
            status?: TransactionStatus
            paymentMethod?: string
            source?: string
        }

    if (categoryId !== undefined) {
        await validateCategoryForTransaction(categoryId, userId)
        transaction.categoryId = new Types.ObjectId(categoryId)
    }
    if (title !== undefined) transaction.title = String(title).trim()
    if (amount !== undefined) {
        const amountMinor = Number(amount)
        if (isNaN(amountMinor)) {
            throw new CustomError('Invalid amount format', 400)
        }
        transaction.amount = amountMinor
    }
    if (description !== undefined) transaction.description = String(description).trim() || undefined
    if (date !== undefined) {
        if (isNaN(Date.parse(date))) {
            throw new CustomError('Invalid date format', 400)
        }
        transaction.date = new Date(date)
    }
    if (paymentMethod !== undefined) transaction.paymentMethod = String(paymentMethod).trim() || undefined
    if (source !== undefined) transaction.source = String(source).trim() || undefined
    if (tags !== undefined) transaction.tags = tags
    if (status !== undefined) transaction.status = status

    await transaction.save()
    await evaluateBudgetOverLimitNotifications(userId, transaction)
    return transaction
}

/**
 * Transfer-create logic for POST /sync/push (Sprint 13.3), mirroring
 * transactionController.createTransfer. `payload.amount` is minor units
 * directly (the sync wire convention), unlike the REST endpoint's
 * major-unit body — callers must not run this through the
 * fromMinorUnits/parseClientAmount round-trip used for plain transaction.create.
 */
export const createTransferForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<string> => {
    validateRequiredFields(payload, ['amount', 'date', 'fromAccountId', 'toAccountId'])

    const { amount, date, fromAccountId, toAccountId, title, description, status, workspaceId } =
        payload as {
            amount: unknown
            date: string
            fromAccountId: string
            toAccountId: string
            title?: string
            description?: string
            status?: string
            workspaceId?: unknown
        }

    if (fromAccountId === toAccountId) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.SAME_TRANSFER_ACCOUNT, 400)
    }
    if (isNaN(Date.parse(date))) {
        throw new CustomError('Invalid date format', 400)
    }

    const amountMinor = Number(amount)
    if (isNaN(amountMinor) || amountMinor < 0) {
        throw new CustomError('Invalid amount format', 400)
    }

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
    const trimmedTitle = (title ?? 'Transfer').trim()
    const trimmedDescription = description?.trim()

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
    } catch (error) {
        if (inbound) {
            await Transaction.deleteOne({ _id: inbound._id })
        }
        if (outbound) {
            await Transaction.deleteOne({ _id: outbound._id })
        }
        throw error
    }

    return outbound._id.toString()
}

// --- REST endpoint logic (moved out of the controllers by RF14) ---

const loadTransaction = (
    transactionId: string,
    userId: string,
    minRole: 'viewer' | 'editor'
): Promise<ITransaction> =>
    validateResourceAccess<ITransaction>(
        Transaction,
        transactionId,
        userId,
        ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
        minRole
    )

export const getTransactionDetail = async (
    transactionId: string,
    userId: string
): Promise<SerializedTransactionWithSplits> => {
    const transaction = await loadTransaction(transactionId, userId, 'viewer')

    const payload: SerializedTransactionWithSplits = await serializeTransactionWithSplits(
        transaction,
        userId
    )

    if (isTransferLeg(transaction) && transaction.transferPairId) {
        const pair = await loadTransaction(transaction.transferPairId.toString(), userId, 'viewer')
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

    return enriched
}

export const createTransfer = async (userId: string, body: Record<string, unknown>) => {
    validateRequiredFields(body, ['title', 'amount', 'date', 'fromAccountId', 'toAccountId'])

    const { title, amount, date, fromAccountId, toAccountId, description, status, workspaceId } =
        body as {
            title: string
            amount: unknown
            date: string
            fromAccountId: string
            toAccountId: string
            description?: string
            status?: string
            workspaceId?: unknown
        }

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
    } catch (error) {
        if (inbound) {
            await Transaction.deleteOne({ _id: inbound._id })
        }
        if (outbound) {
            await Transaction.deleteOne({ _id: outbound._id })
        }
        throw error
    }

    return {
        outbound: serializeTransaction(outbound),
        inbound: serializeTransaction(inbound),
    }
}

const SUPPORTED_UPDATE_TYPES = ['income', 'expense'] as const

export const updateTransactionForUser = async (
    transactionId: string,
    userId: string,
    body: Record<string, unknown>
) => {
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
    } = body as Record<string, string | undefined> & { amount?: unknown; tags?: string[] }

    const transaction = await loadTransaction(transactionId, userId, 'editor')

    assertEditableTransaction(transaction)

    const splitChildren = await fetchSplitChildren(transaction._id, userId)
    if (splitChildren.length > 0) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.SPLIT_NOT_EDITABLE, 400)
    }

    if (
        type !== undefined &&
        !SUPPORTED_UPDATE_TYPES.includes(type as (typeof SUPPORTED_UPDATE_TYPES)[number])
    ) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.UNSUPPORTED_TYPE, 400)
    }

    const nextType = (type ?? transaction.type) as ITransaction['type']
    const nextAmountMinor = amount !== undefined ? parseClientAmount(amount) : transaction.amount
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
    if (categoryId !== undefined) transaction.categoryId = new Types.ObjectId(categoryId)
    if (date !== undefined) transaction.date = nextDate
    if (accountId !== undefined) {
        const account = await validateAccountForTransaction(accountId, userId)
        assertAccountMatchesWorkspace(account.workspaceId, transactionWorkspaceId)
        transaction.accountId = new Types.ObjectId(accountId)
        transaction.currency = account.currency
    }
    if (type !== undefined) transaction.type = type as ITransaction['type']
    if (source !== undefined) transaction.source = source.trim() || undefined
    if (paymentMethod !== undefined) transaction.paymentMethod = paymentMethod.trim() || undefined
    if (tags !== undefined) transaction.tags = tags
    if (status !== undefined) transaction.status = status as TransactionStatus

    await transaction.save()
    await evaluateBudgetOverLimitNotifications(userId, transaction)
    return serializeTransaction(transaction)
}

export const deleteTransaction = async (transactionId: string, userId: string) => {
    const transaction = await loadTransaction(transactionId, userId, 'editor')
    await deleteTransactionForUser(userId, transaction)

    return {
        message:
            isTransferLeg(transaction) && transaction.transferPairId
                ? 'Transfer deleted successfully'
                : 'Transaction deleted successfully',
    }
}

export const duplicateTransaction = async (transactionId: string, userId: string) => {
    const transaction = await loadTransaction(transactionId, userId, 'editor')

    assertEditableTransaction(transaction)

    const splitChildren = await fetchSplitChildren(transaction._id, userId)
    if (splitChildren.length > 0) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.SPLIT_NOT_EDITABLE, 400)
    }

    const account = await validateAccountForTransaction(transaction.accountId.toString(), userId)
    const duplicate = await Transaction.create(duplicateTransactionFields(transaction, userId))
    await applyTransactionToAccount(account, duplicate.type, duplicate.amount)

    return serializeTransaction(duplicate)
}

export const attachReceipt = async (
    transactionId: string,
    receiptId: string,
    userId: string
): Promise<SerializedTransactionWithSplits> => {
    const [transaction, receipt] = await Promise.all([
        loadTransaction(transactionId, userId, 'editor'),
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

    return serializeTransactionWithSplits(transaction, userId)
}

export const detachReceipt = async (
    transactionId: string,
    receiptId: string,
    userId: string
): Promise<SerializedTransactionWithSplits> => {
    const transaction = await loadTransaction(transactionId, userId, 'editor')

    if (isSplitChild(transaction)) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.SPLIT_NOT_EDITABLE, 400)
    }

    const existingIds = transaction.receiptIds?.map((id) => id.toString()) ?? []
    if (!existingIds.includes(receiptId)) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.RECEIPT_NOT_ATTACHED, 400)
    }

    transaction.receiptIds = transaction.receiptIds?.filter((id) => id.toString() !== receiptId)
    await transaction.save()

    return serializeTransactionWithSplits(transaction, userId)
}
