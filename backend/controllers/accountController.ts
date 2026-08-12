import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import Account, { ACCOUNT_TYPES } from '../models/Account'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { roundMoney } from '../utils/balanceUtils'
import {
    getUserId,
    handleResponses,
    validateOwnership,
    validateRequiredFields,
} from '../utils/sharedUtils'

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

export const createAccount = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    validateRequiredFields(req.body, ['name', 'type'])

    const { name, type, currency, openingBalance, isDefault } = req.body

    if (!ACCOUNT_TYPES.includes(type)) {
        throw new CustomError(`Invalid account type. Must be one of: ${ACCOUNT_TYPES.join(', ')}`, 400)
    }

    if (req.body.currentBalance !== undefined) {
        throw new CustomError('currentBalance is server-derived and cannot be set directly', 400)
    }

    const parsedOpeningBalance = parseOpeningBalance(openingBalance)
    const activeAccountCount = await Account.countDocuments({ userId, isArchived: false })
    const shouldBeDefault = isDefault === true || activeAccountCount === 0

    if (shouldBeDefault) {
        await unsetPreviousDefault(userId)
    }

    const account = await Account.create({
        userId,
        name: name.trim(),
        type,
        currency: currency?.trim().toUpperCase() ?? 'USD',
        openingBalance: parsedOpeningBalance,
        currentBalance: parsedOpeningBalance,
        isDefault: shouldBeDefault,
    })

    handleResponses(res, 201, account)
})

export const getAccounts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const includeArchived = req.query.includeArchived === 'true'

    const filter: Record<string, unknown> = { userId }
    if (!includeArchived) {
        filter.isArchived = false
    }

    const accounts = await Account.find(filter).sort({ isDefault: -1, name: 1 })

    handleResponses(res, 200, accounts)
})

export const getAccountById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { accountId } = req.params

    validateRequiredFields({ accountId }, ['accountId'])

    const account = await validateOwnership(
        Account,
        accountId,
        userId,
        ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND
    )

    handleResponses(res, 200, account)
})

export const updateAccount = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { accountId } = req.params
    const { name, type, currency, isDefault } = req.body

    validateRequiredFields({ accountId }, ['accountId'])

    if (req.body.currentBalance !== undefined || req.body.openingBalance !== undefined) {
        throw new CustomError('Balance fields are server-derived and cannot be updated directly', 400)
    }

    const account = await validateOwnership(
        Account,
        accountId,
        userId,
        ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND
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

    if (name !== undefined) {
        if (!name.trim()) {
            throw new CustomError('Account name cannot be empty', 400)
        }
        account.name = name.trim()
    }

    if (currency !== undefined) {
        account.currency = currency.trim().toUpperCase()
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

    const account = await validateOwnership(
        Account,
        accountId,
        userId,
        ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND
    )

    if (account.isArchived) {
        throw new CustomError(ERROR_MESSAGES.ACCOUNT.ACCOUNT_ALREADY_ARCHIVED, 400)
    }

    account.isArchived = true
    account.isDefault = false
    await account.save()

    handleResponses(res, 200, { message: 'Account archived successfully', data: account })
})
