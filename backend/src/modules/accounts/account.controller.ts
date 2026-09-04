import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { ACCOUNT_TYPES, AccountType } from './account.model'
import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { roundMoney } from './accountBalance'
import { parseOptionalSupportedCurrency, parseSupportedCurrency } from '@core/money/currencyUtils'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { resolveClientObjectId } from '@core/db/objectId'
import { parseOptionalWorkspaceId } from '@core/access/workspace'
import { validateRequiredFields } from '@core/http/validation'
import {
    ConversionContext,
    archiveAccount as archiveAccountService,
    createAccount as createAccountService,
    getAccount as getAccountService,
    listAccounts as listAccountsService,
    recomputeBalance as recomputeBalanceService,
    updateAccount as updateAccountService,
} from './account.service'

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

const parseAccountType = (value: unknown): AccountType => {
    if (!ACCOUNT_TYPES.includes(value as AccountType)) {
        throw new CustomError(
            `Invalid account type. Must be one of: ${ACCOUNT_TYPES.join(', ')}`,
            400
        )
    }
    return value as AccountType
}

const assertCreditOnlyFields = (type: string, body: Record<string, unknown>): void => {
    if (
        type !== 'credit' &&
        (body.interestRate !== undefined || body.minimumPayment !== undefined)
    ) {
        throw new CustomError(
            'interestRate and minimumPayment can only be set on credit accounts',
            400
        )
    }
}

const conversionContext = (req: AuthRequest): ConversionContext => ({
    preferredCurrency: req.user!.preferredCurrency,
    exchangeRates: req.user!.exchangeRates ?? {},
})

export const createAccount = asyncHandler(async (req: AuthRequest, res: Response) => {
    validateRequiredFields(req.body, ['name', 'type'])

    const { name, type, currency, openingBalance, isDefault } = req.body

    if (req.body.currentBalance !== undefined) {
        throw new CustomError('currentBalance is server-derived and cannot be set directly', 400)
    }

    const parsedType = parseAccountType(type)
    assertCreditOnlyFields(parsedType, req.body)

    const account = await createAccountService({
        userId: getUserId(req),
        workspaceId: parseOptionalWorkspaceId(req.body.workspaceId) ?? null,
        name: name.trim(),
        type: parsedType,
        currency: parseOptionalSupportedCurrency(currency),
        openingBalance: parseOpeningBalance(openingBalance),
        openingBalanceDate: parseOpeningBalanceDate(req.body.openingBalanceDate),
        isDefault: isDefault === true,
        interestRate: parseOptionalNonNegativeNumber(req.body.interestRate, 'interestRate'),
        minimumPayment: parseOptionalNonNegativeNumber(req.body.minimumPayment, 'minimumPayment'),
        clientId: resolveClientObjectId(req.body._id) ?? null,
    })

    handleResponses(res, 201, account)
})

export const getAccounts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const accounts = await listAccountsService({
        userId: getUserId(req),
        workspaceId: parseOptionalWorkspaceId(req.query.workspaceId) ?? null,
        includeArchived: req.query.includeArchived === 'true',
        conversion: conversionContext(req),
    })

    handleResponses(res, 200, accounts)
})

export const getAccountById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { accountId } = req.params
    validateRequiredFields({ accountId }, ['accountId'])

    handleResponses(
        res,
        200,
        await getAccountService(accountId, getUserId(req), conversionContext(req))
    )
})

export const updateAccount = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { accountId } = req.params
    const { name, type, currency, isDefault } = req.body

    validateRequiredFields({ accountId }, ['accountId'])

    if (req.body.currentBalance !== undefined) {
        throw new CustomError(
            'currentBalance is server-derived and cannot be updated directly',
            400
        )
    }

    let parsedName: string | undefined
    if (name !== undefined) {
        if (!String(name).trim()) {
            throw new CustomError('Account name cannot be empty', 400)
        }
        parsedName = String(name).trim()
    }

    const serialized = await updateAccountService({
        accountId,
        userId: getUserId(req),
        type: type !== undefined ? parseAccountType(type) : undefined,
        interestRate:
            req.body.interestRate !== undefined
                ? (parseOptionalNonNegativeNumber(req.body.interestRate, 'interestRate') ?? null)
                : undefined,
        minimumPayment:
            req.body.minimumPayment !== undefined
                ? (parseOptionalNonNegativeNumber(req.body.minimumPayment, 'minimumPayment') ??
                  null)
                : undefined,
        name: parsedName,
        currency: currency !== undefined ? parseSupportedCurrency(currency) : undefined,
        openingBalance:
            req.body.openingBalance !== undefined
                ? parseOpeningBalance(req.body.openingBalance)
                : undefined,
        openingBalanceDate:
            req.body.openingBalanceDate !== undefined
                ? parseOpeningBalanceDate(req.body.openingBalanceDate)
                : undefined,
        openingBalanceDateProvided: req.body.openingBalanceDate !== undefined,
        isDefault: isDefault === true ? true : isDefault === false ? false : undefined,
    })

    handleResponses(res, 200, serialized)
})

export const archiveAccount = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { accountId } = req.params
    validateRequiredFields({ accountId }, ['accountId'])

    const serialized = await archiveAccountService(accountId, getUserId(req))
    handleResponses(res, 200, { message: 'Account archived successfully', data: serialized })
})

export const recomputeBalance = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { accountId } = req.params
    validateRequiredFields({ accountId }, ['accountId'])

    handleResponses(res, 200, await recomputeBalanceService(accountId, getUserId(req)))
})
