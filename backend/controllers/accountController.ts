import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import Account, { ACCOUNT_TYPES, IAccount } from '../models/Account'
import { AuthRequest } from '@core/auth/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { recomputeAccountBalanceMajor, roundMoney } from '../utils/balanceUtils'
import { toMajorUnitBalances } from '../utils/accountWireFormat'
import { parseOptionalSupportedCurrency, parseSupportedCurrency } from '@core/money/currencyUtils'
import { convertAmount } from '../utils/exchangeRateUtils'
import { fromMinorUnits, toMinorUnits } from '@shared/money'
import {
    assertWorkspaceMembership,
    buildScopedListFilter,
    parseOptionalWorkspaceId,
    validateResourceAccess,
} from '@core/access/workspace'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { isDuplicateKeyError, resolveClientObjectId } from '@core/db/objectId'
import { validateRequiredFields } from '@core/http/validation'

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

/**
 * The date the opening balance is stated "as of" — transactions before it don't
 * move `currentBalance` (see shared/src/balances.ts). `undefined`/`null`/`''`
 * means "no cutoff" (legacy: every transaction counts).
 */
const parseOpeningBalanceDate = (value: unknown): Date | null => {
    if (value === undefined || value === null || value === '') {
        return null
    }
    const parsed = new Date(value as string | number)
    if (isNaN(parsed.getTime())) {
        throw new CustomError('Invalid opening balance date', 400)
    }
    return parsed
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

const serializeAccount = (account: IAccount) => ({
    ...account.toObject(),
    // The API contract is unchanged by Sprint C5: balances are always major-unit
    // decimals on the wire, whatever the row's internal `balanceUnit` storage
    // form. Shared with the /sync wire format via accountWireFormat.ts.
    ...toMajorUnitBalances(account),
})

const withConvertedBalance = (
    account: IAccount,
    preferredCurrency: string,
    exchangeRates: Record<string, number>
) => {
    const serialized = serializeAccount(account)
    const { convertedAmount, rateApplied, rateConfigured } = convertAmount(
        serialized.currentBalance,
        account.currency,
        preferredCurrency,
        exchangeRates
    )
    return {
        ...serialized,
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
    const parsedOpeningBalanceDate = parseOpeningBalanceDate(req.body.openingBalanceDate)
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
            openingBalanceDate: parsedOpeningBalanceDate,
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

    if (req.body.currentBalance !== undefined) {
        throw new CustomError('currentBalance is server-derived and cannot be updated directly', 400)
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

    // Opening balance and its "as of" date are user-editable (unlike
    // currentBalance): a fresh account holder who later imports history dated
    // before the account started re-points the anchor. Any change here forces a
    // full balance recompute so currentBalance stays consistent.
    let recomputeNeeded = false
    if (req.body.openingBalance !== undefined) {
        const parsed = parseOpeningBalance(req.body.openingBalance)
        account.openingBalance = account.balanceUnit === 'minor' ? toMinorUnits(parsed) : parsed
        recomputeNeeded = true
    }
    if (req.body.openingBalanceDate !== undefined) {
        account.openingBalanceDate = parseOpeningBalanceDate(req.body.openingBalanceDate)
        recomputeNeeded = true
    }

    if (isDefault === true) {
        await unsetPreviousDefault(userId, accountId)
        account.isDefault = true
    } else if (isDefault === false && account.isDefault) {
        throw new CustomError(ERROR_MESSAGES.ACCOUNT.CANNOT_UNSET_DEFAULT, 400)
    }

    await account.save()

    if (recomputeNeeded) {
        const recomputedMajor = await recomputeAccountBalanceMajor(account, userId)
        account.currentBalance =
            account.balanceUnit === 'minor' ? toMinorUnits(recomputedMajor) : recomputedMajor
        await account.save()
    }

    handleResponses(res, 200, serializeAccount(account))
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

    handleResponses(res, 200, { message: 'Account archived successfully', data: serializeAccount(account) })
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

    // recomputeAccountBalanceMajor (balanceUtils.ts) owns the transfer-leg
    // direction reconstruction and the openingBalanceDate cutoff, and is shared
    // with updateAccount and the sync push path. It returns major units; a
    // migrated ('minor') account converts back for storage here.
    const isMinor = account.balanceUnit === 'minor'
    const previousBalance = isMinor ? fromMinorUnits(account.currentBalance) : account.currentBalance
    const recomputedBalance = await recomputeAccountBalanceMajor(account, userId)

    account.currentBalance = isMinor ? toMinorUnits(recomputedBalance) : recomputedBalance
    await account.save()

    handleResponses(res, 200, {
        accountId: account._id.toString(),
        previousBalance,
        recomputedBalance,
    })
})
