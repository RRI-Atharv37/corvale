import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import Account, { ACCOUNT_TYPES, IAccount } from '../models/Account'
import Transaction from '../models/Transaction'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { roundMoney } from '../utils/balanceUtils'
import { parseOptionalSupportedCurrency, parseSupportedCurrency } from '../utils/currencyUtils'
import { convertAmount } from '../utils/exchangeRateUtils'
import { recomputeAccountBalance } from '../../shared/src/balances'
import {
    getUserId,
    handleResponses,
    isDuplicateKeyError,
    resolveClientObjectId,
    validateRequiredFields,
} from '../utils/sharedUtils'
import {
    assertWorkspaceMembership,
    buildScopedListFilter,
    parseOptionalWorkspaceId,
    validateResourceAccess,
} from '../utils/workspaceUtils'

const unsetPreviousDefault = async (userId: string, excludeAccountId?: string): Promise<void> => {
    const filter: Record<string, unknown> = { userId, isDefault: true, isArchived: false }
    if (excludeAccountId) {
        filter._id = { $ne: excludeAccountId }
    }
    await Account.updateMany(filter, { $set: { isDefault: false } })
}

const parseOpeningBalance = (value: unknown): number => {
    const balance = roundMoney(Number(value ?? 0))
    if (isNaN(balance)) {
        throw new CustomError('Invalid opening balance format', 400)
    }
    return balance
}

const parseOptionalNonNegativeNumber = (value: unknown, fieldName: string): number | undefined => {
    if (value === undefined || value === null) {
        return undefined
    }
    const parsed = Number(value)
    if (isNaN(parsed) || parsed < 0) {
        throw new CustomError(`Invalid ${fieldName}; must be a non-negative number`, 400)
    }
    return roundMoney(parsed)
}

const withConvertedBalance = (
    account: IAccount,
    preferredCurrency: string,
    exchangeRates: Record<string, number>
) => {
    const { convertedAmount, rateApplied, rateConfigured } = convertAmount(
        account.currentBalance,
        account.currency,
        preferredCurrency,
        exchangeRates
    )
    return {
        ...account.toObject(),
        convertedBalance: roundMoney(convertedAmount),
        exchangeRateApplied: rateApplied,
        hasExchangeRate: rateConfigured,
    }
}

const assertCreditOnlyFields = (type: string, body: Record<string, unknown>): void => {
    if (type !== 'credit' && (body.interestRate !== undefined || body.minimumPayment !== undefined)) {
        throw new CustomError('interestRate and minimumPayment can only be set on credit accounts', 400)
    }
}

export const createAccount = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    validateRequiredFields(req.body, ['name', 'type'])

    const { name, type, currency, openingBalance, isDefault } = req.body
    const workspaceId = parseOptionalWorkspaceId(req.body.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'editor')
    }

    if (!ACCOUNT_TYPES.includes(type)) {
        throw new CustomError(`Invalid account type. Must be one of: ${ACCOUNT_TYPES.join(', ')}`, 400)
    }

    if (req.body.currentBalance !== undefined) {
        throw new CustomError('currentBalance is server-derived and cannot be set directly', 400)
    }

    assertCreditOnlyFields(type, req.body)
    const interestRate = parseOptionalNonNegativeNumber(req.body.interestRate, 'interestRate')
    const minimumPayment = parseOptionalNonNegativeNumber(req.body.minimumPayment, 'minimumPayment')

    const clientId = resolveClientObjectId(req.body._id)
    const parsedOpeningBalance = parseOpeningBalance(openingBalance)
    const activeAccountCount = await Account.countDocuments(
        workspaceId
            ? { workspaceId, isArchived: false }
            : { userId, workspaceId: null, isArchived: false }
    )
    const shouldBeDefault = !workspaceId && (isDefault === true || activeAccountCount === 0)

    if (shouldBeDefault) {
        await unsetPreviousDefault(userId)
    }

    let account
    try {
        account = await Account.create({
            ...(clientId ? { _id: clientId } : {}),
            userId,
            workspaceId,
            name: name.trim(),
            type,
            currency: parseOptionalSupportedCurrency(currency),
            openingBalance: parsedOpeningBalance,
            currentBalance: parsedOpeningBalance,
            isDefault: shouldBeDefault,
            interestRate,
            minimumPayment,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('An account with this id already exists', 400)
        }
        throw error
    }

    handleResponses(res, 201, account)
})

export const getAccounts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const includeArchived = req.query.includeArchived === 'true'
    const workspaceId = parseOptionalWorkspaceId(req.query.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'viewer')
    }

    const filter: Record<string, unknown> = buildScopedListFilter(userId, workspaceId)
    if (!includeArchived) {
        filter.isArchived = false
    }

    const accounts = await Account.find(filter).sort({ isDefault: -1, name: 1 })
    const preferredCurrency = req.user!.preferredCurrency
    const exchangeRates = req.user!.exchangeRates ?? {}

    handleResponses(
        res,
        200,
        accounts.map((account) => withConvertedBalance(account, preferredCurrency, exchangeRates))
    )
})

export const getAccountById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { accountId } = req.params

    validateRequiredFields({ accountId }, ['accountId'])

    const account = await validateResourceAccess(
        Account,
        accountId,
        userId,
        ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
        'viewer'
    )

    handleResponses(
        res,
        200,
        withConvertedBalance(account, req.user!.preferredCurrency, req.user!.exchangeRates ?? {})
    )
})

export const updateAccount = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { accountId } = req.params
    const { name, type, currency, isDefault } = req.body

    validateRequiredFields({ accountId }, ['accountId'])

    if (req.body.currentBalance !== undefined || req.body.openingBalance !== undefined) {
        throw new CustomError('Balance fields are server-derived and cannot be updated directly', 400)
    }

    const account = await validateResourceAccess(
        Account,
        accountId,
        userId,
        ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
        'editor'
    )

    if (account.isArchived) {
        throw new CustomError(ERROR_MESSAGES.ACCOUNT.ACCOUNT_ARCHIVED, 400)
    }

    if (type !== undefined) {
        if (!ACCOUNT_TYPES.includes(type)) {
            throw new CustomError(
                `Invalid account type. Must be one of: ${ACCOUNT_TYPES.join(', ')}`,
                400
            )
        }
        account.type = type
    }

    assertCreditOnlyFields(account.type, req.body)

    if (req.body.interestRate !== undefined) {
        account.interestRate = parseOptionalNonNegativeNumber(req.body.interestRate, 'interestRate')
    }

    if (req.body.minimumPayment !== undefined) {
        account.minimumPayment = parseOptionalNonNegativeNumber(req.body.minimumPayment, 'minimumPayment')
    }

    if (name !== undefined) {
        if (!name.trim()) {
            throw new CustomError('Account name cannot be empty', 400)
        }
        account.name = name.trim()
    }

    if (currency !== undefined) {
        account.currency = parseSupportedCurrency(currency)
    }

    if (isDefault === true) {
        await unsetPreviousDefault(userId, accountId)
        account.isDefault = true
    } else if (isDefault === false && account.isDefault) {
        throw new CustomError(ERROR_MESSAGES.ACCOUNT.CANNOT_UNSET_DEFAULT, 400)
    }

    const updatedAccount = await account.save()
    handleResponses(res, 200, updatedAccount)
})

export const archiveAccount = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { accountId } = req.params

    validateRequiredFields({ accountId }, ['accountId'])

    const account = await validateResourceAccess(
        Account,
        accountId,
        userId,
        ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
        'editor'
    )

    if (account.isArchived) {
        throw new CustomError(ERROR_MESSAGES.ACCOUNT.ACCOUNT_ALREADY_ARCHIVED, 400)
    }

    account.isArchived = true
    account.isDefault = false
    await account.save()

    handleResponses(res, 200, { message: 'Account archived successfully', data: account })
})

export const recomputeBalance = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { accountId } = req.params

    validateRequiredFields({ accountId }, ['accountId'])

    const account = await validateResourceAccess(
        Account,
        accountId,
        userId,
        ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
        'editor'
    )

    const scope = buildScopedListFilter(userId, account.workspaceId?.toString() ?? null)

    const transactions = await Transaction.find({
        ...scope,
        accountId: account._id,
    }).select('type amount status splitTransactionId transferPairId createdAt')

    // Both legs of a transfer persist with type: 'transfer' (see
    // transactionController.createTransfer) — direction (in vs out) is only
    // recoverable via creation order relative to the paired leg, the same
    // technique deleteTransactionForUser uses. The outbound leg keeps the
    // 'transfer' delta formula; the inbound leg is fed as 'income' to reuse
    // getTransferInDeltaMajor's formula (see shared/src/money.ts).
    const pairIds = transactions
        .filter((transaction) => transaction.type === 'transfer' && transaction.transferPairId)
        .map((transaction) => transaction.transferPairId!)

    const pairs = pairIds.length
        ? await Transaction.find({ ...scope, _id: { $in: pairIds } }).select('createdAt')
        : []
    const pairCreatedAtById = new Map(
        pairs.map((pair) => [pair._id.toString(), pair.createdAt])
    )

    const previousBalance = account.currentBalance
    const recomputedBalance = recomputeAccountBalance(
        { openingBalance: account.openingBalance, type: account.type },
        transactions.map((transaction) => {
            let effectiveType = transaction.type

            if (transaction.type === 'transfer' && transaction.transferPairId) {
                const pairCreatedAt = pairCreatedAtById.get(transaction.transferPairId.toString())
                const isInbound = pairCreatedAt !== undefined && transaction.createdAt > pairCreatedAt
                effectiveType = isInbound ? 'income' : 'transfer'
            }

            return {
                type: effectiveType,
                amount: transaction.amount,
                status: transaction.status,
                splitTransactionId: transaction.splitTransactionId?.toString() ?? null,
            }
        })
    )

    account.currentBalance = recomputedBalance
    await account.save()

    handleResponses(res, 200, {
        accountId: account._id.toString(),
        previousBalance,
        recomputedBalance,
    })
})
