import Account, { AccountType, IAccount } from './account.model'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { recomputeAccountBalanceMajor, roundMoney } from './accountBalance'
import { toMajorUnitBalances } from '@core/money/accountWireFormat'
import { fromMinorUnits, toMinorUnits } from '@shared/money'
import { Types } from 'mongoose'
import { buildScopedListFilter } from '@core/access/workspace'
import { isDuplicateKeyError } from '@core/db/objectId'
import { convertAmount } from '@modules/exchange-rates/exchangeRateUtils'
import { assertWorkspaceMembership, validateResourceAccess } from '@modules/workspaces/access'

export interface ConversionContext {
    preferredCurrency: string
    exchangeRates: Record<string, number>
}

export const serializeAccount = (account: IAccount) => ({
    ...account.toObject(),
    ...toMajorUnitBalances(account),
})

const withConvertedBalance = (account: IAccount, ctx: ConversionContext) => {
    const serialized = serializeAccount(account)
    const { convertedAmount, rateApplied, rateConfigured } = convertAmount(
        serialized.currentBalance,
        account.currency,
        ctx.preferredCurrency,
        ctx.exchangeRates
    )
    return {
        ...serialized,
        convertedBalance: roundMoney(convertedAmount),
        exchangeRateApplied: rateApplied,
        hasExchangeRate: rateConfigured,
    }
}

const unsetPreviousDefault = async (userId: string, excludeAccountId?: string): Promise<void> => {
    const filter: Record<string, unknown> = { userId, isDefault: true, isArchived: false }
    if (excludeAccountId) {
        filter._id = { $ne: excludeAccountId }
    }
    await Account.updateMany(filter, { $set: { isDefault: false } })
}

const loadAccount = (
    accountId: string,
    userId: string,
    minRole: 'viewer' | 'editor'
): Promise<IAccount> =>
    validateResourceAccess<IAccount>(
        Account,
        accountId,
        userId,
        ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
        minRole
    )

export interface CreateAccountInput {
    userId: string
    workspaceId: string | null
    name: string
    type: AccountType
    currency?: string
    openingBalance: number
    openingBalanceDate: Date | null
    isDefault: boolean
    interestRate?: number
    minimumPayment?: number
    clientId: Types.ObjectId | null
}

export const createAccount = async (input: CreateAccountInput): Promise<IAccount> => {
    if (input.workspaceId) {
        await assertWorkspaceMembership(input.workspaceId, input.userId, 'editor')
    }

    const activeAccountCount = await Account.countDocuments(
        input.workspaceId
            ? { workspaceId: input.workspaceId, isArchived: false }
            : { userId: input.userId, workspaceId: null, isArchived: false }
    )
    const shouldBeDefault =
        !input.workspaceId && (input.isDefault === true || activeAccountCount === 0)

    if (shouldBeDefault) {
        await unsetPreviousDefault(input.userId)
    }

    try {
        return await Account.create({
            ...(input.clientId ? { _id: input.clientId } : {}),
            userId: input.userId,
            workspaceId: input.workspaceId,
            name: input.name,
            type: input.type,
            currency: input.currency,
            openingBalance: input.openingBalance,
            openingBalanceDate: input.openingBalanceDate,
            currentBalance: input.openingBalance,
            isDefault: shouldBeDefault,
            interestRate: input.interestRate,
            minimumPayment: input.minimumPayment,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('An account with this id already exists', 400)
        }
        throw error
    }
}

export interface ListAccountsInput {
    userId: string
    workspaceId: string | null
    includeArchived: boolean
    conversion: ConversionContext
}

export const listAccounts = async (input: ListAccountsInput) => {
    if (input.workspaceId) {
        await assertWorkspaceMembership(input.workspaceId, input.userId, 'viewer')
    }

    const filter: Record<string, unknown> = buildScopedListFilter(input.userId, input.workspaceId)
    if (!input.includeArchived) {
        filter.isArchived = false
    }

    const accounts = await Account.find(filter).sort({ isDefault: -1, name: 1 })
    return accounts.map((account) => withConvertedBalance(account, input.conversion))
}

export const getAccount = async (
    accountId: string,
    userId: string,
    conversion: ConversionContext
) => {
    const account = await loadAccount(accountId, userId, 'viewer')
    return withConvertedBalance(account, conversion)
}

export interface UpdateAccountInput {
    accountId: string
    userId: string
    type?: AccountType
    /** `undefined` = leave; `null` = clear. */
    interestRate?: number | null
    minimumPayment?: number | null
    name?: string
    currency?: string
    openingBalance?: number
    openingBalanceDate?: Date | null
    openingBalanceDateProvided: boolean
    isDefault?: boolean
}

export const updateAccount = async (input: UpdateAccountInput) => {
    const account = await loadAccount(input.accountId, input.userId, 'editor')

    if (account.isArchived) {
        throw new CustomError(ERROR_MESSAGES.ACCOUNT.ACCOUNT_ARCHIVED, 400)
    }

    if (input.type !== undefined) {
        account.type = input.type
    }

    if (
        account.type !== 'credit' &&
        (input.interestRate !== undefined || input.minimumPayment !== undefined)
    ) {
        throw new CustomError(
            'interestRate and minimumPayment can only be set on credit accounts',
            400
        )
    }

    if (input.interestRate !== undefined) {
        account.interestRate = input.interestRate ?? undefined
    }
    if (input.minimumPayment !== undefined) {
        account.minimumPayment = input.minimumPayment ?? undefined
    }
    if (input.name !== undefined) {
        account.name = input.name
    }
    if (input.currency !== undefined) {
        account.currency = input.currency
    }

    let recomputeNeeded = false
    if (input.openingBalance !== undefined) {
        account.openingBalance =
            account.balanceUnit === 'minor'
                ? toMinorUnits(input.openingBalance)
                : input.openingBalance
        recomputeNeeded = true
    }
    if (input.openingBalanceDateProvided) {
        account.openingBalanceDate = input.openingBalanceDate ?? null
        recomputeNeeded = true
    }

    if (input.isDefault === true) {
        await unsetPreviousDefault(input.userId, input.accountId)
        account.isDefault = true
    } else if (input.isDefault === false && account.isDefault) {
        throw new CustomError(ERROR_MESSAGES.ACCOUNT.CANNOT_UNSET_DEFAULT, 400)
    }

    await account.save()

    if (recomputeNeeded) {
        const recomputedMajor = await recomputeAccountBalanceMajor(account, input.userId)
        account.currentBalance =
            account.balanceUnit === 'minor' ? toMinorUnits(recomputedMajor) : recomputedMajor
        await account.save()
    }

    return serializeAccount(account)
}

export const archiveAccount = async (accountId: string, userId: string) => {
    const account = await loadAccount(accountId, userId, 'editor')

    if (account.isArchived) {
        throw new CustomError(ERROR_MESSAGES.ACCOUNT.ACCOUNT_ALREADY_ARCHIVED, 400)
    }

    account.isArchived = true
    account.isDefault = false
    await account.save()

    return serializeAccount(account)
}

export const recomputeBalance = async (accountId: string, userId: string) => {
    const account = await loadAccount(accountId, userId, 'editor')

    const isMinor = account.balanceUnit === 'minor'
    const previousBalance = isMinor
        ? fromMinorUnits(account.currentBalance)
        : account.currentBalance
    const recomputedBalance = await recomputeAccountBalanceMajor(account, userId)

    account.currentBalance = isMinor ? toMinorUnits(recomputedBalance) : recomputedBalance
    await account.save()

    return {
        accountId: account._id.toString(),
        previousBalance,
        recomputedBalance,
    }
}
