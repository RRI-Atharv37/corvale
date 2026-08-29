import Account, { ACCOUNT_TYPES, IAccount } from '../models/Account'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { recomputeAccountBalanceMajor, roundMoney } from '../utils/balanceUtils'
import { toMinorUnits } from '../../shared/src/money'
import { parseOptionalSupportedCurrency, parseSupportedCurrency } from '../utils/currencyUtils'
import { isDuplicateKeyError, resolveClientObjectId, validateRequiredFields } from '../utils/sharedUtils'
import { assertWorkspaceMembership, parseOptionalWorkspaceId, validateResourceAccess } from '../utils/workspaceUtils'
import { archiveEntityForOp, DeleteOpOutcome } from './syncEntityHelpers'

/**
 * Sprint 13.9: create/update/delete logic for POST /sync/push, mirroring
 * accountController's createAccount/updateAccount/archiveAccount exactly
 * (same validation, same error messages/status codes) so the sync path and
 * REST path stay behaviorally identical. syncController.ts owns the
 * create-noop-on-duplicate-id and update conflict/staleness checks that
 * wrap these functions, the same way it already does for transactions.
 */

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

const assertCreditOnlyFields = (type: string, body: Record<string, unknown>): void => {
    if (type !== 'credit' && (body.interestRate !== undefined || body.minimumPayment !== undefined)) {
        throw new CustomError('interestRate and minimumPayment can only be set on credit accounts', 400)
    }
}

export const createAccountForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<IAccount> => {
    validateRequiredFields(payload, ['name', 'type'])

    const { name, type, currency, openingBalance, isDefault } = payload as {
        name: string
        type: string
        currency?: unknown
        openingBalance?: unknown
        isDefault?: boolean
    }
    const workspaceId = parseOptionalWorkspaceId(payload.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'editor')
    }

    if (!ACCOUNT_TYPES.includes(type as (typeof ACCOUNT_TYPES)[number])) {
        throw new CustomError(`Invalid account type. Must be one of: ${ACCOUNT_TYPES.join(', ')}`, 400)
    }

    if (payload.currentBalance !== undefined) {
        throw new CustomError('currentBalance is server-derived and cannot be set directly', 400)
    }

    assertCreditOnlyFields(type, payload)
    const interestRate = parseOptionalNonNegativeNumber(payload.interestRate, 'interestRate')
    const minimumPayment = parseOptionalNonNegativeNumber(payload.minimumPayment, 'minimumPayment')

    const clientId = resolveClientObjectId(payload._id)
    const parsedOpeningBalance = parseOpeningBalance(openingBalance)
    const parsedOpeningBalanceDate = parseOpeningBalanceDate(payload.openingBalanceDate)
    const activeAccountCount = await Account.countDocuments(
        workspaceId
            ? { workspaceId, isArchived: false }
            : { userId, workspaceId: null, isArchived: false }
    )
    const shouldBeDefault = !workspaceId && (isDefault === true || activeAccountCount === 0)

    if (shouldBeDefault) {
        await unsetPreviousDefault(userId)
    }

    try {
        return await Account.create({
            ...(clientId ? { _id: clientId } : {}),
            userId,
            workspaceId,
            name: String(name).trim(),
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
}

export const updateAccountForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<IAccount> => {
    const accountId = payload._id
    if (typeof accountId !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

    if (payload.currentBalance !== undefined) {
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

    const { name, type, currency, isDefault } = payload as {
        name?: string
        type?: string
        currency?: unknown
        isDefault?: boolean
    }

    if (type !== undefined) {
        if (!ACCOUNT_TYPES.includes(type as (typeof ACCOUNT_TYPES)[number])) {
            throw new CustomError(
                `Invalid account type. Must be one of: ${ACCOUNT_TYPES.join(', ')}`,
                400
            )
        }
        account.type = type as IAccount['type']
    }

    assertCreditOnlyFields(account.type, payload)

    if (payload.interestRate !== undefined) {
        account.interestRate = parseOptionalNonNegativeNumber(payload.interestRate, 'interestRate')
    }

    if (payload.minimumPayment !== undefined) {
        account.minimumPayment = parseOptionalNonNegativeNumber(payload.minimumPayment, 'minimumPayment')
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

    let recomputeNeeded = false
    if (payload.openingBalance !== undefined) {
        const parsed = parseOpeningBalance(payload.openingBalance)
        account.openingBalance = account.balanceUnit === 'minor' ? toMinorUnits(parsed) : parsed
        recomputeNeeded = true
    }
    if (payload.openingBalanceDate !== undefined) {
        account.openingBalanceDate = parseOpeningBalanceDate(payload.openingBalanceDate)
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

    return account
}

export const deleteAccountForOp = (
    userId: string,
    payload: Record<string, unknown>
): Promise<DeleteOpOutcome> =>
    archiveEntityForOp(
        Account,
        userId,
        payload,
        ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
        (doc) => doc.isArchived,
        (doc) => {
            doc.isArchived = true
            doc.isDefault = false
        }
    )
