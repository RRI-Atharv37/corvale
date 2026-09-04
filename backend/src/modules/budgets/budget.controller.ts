import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { DEFAULT_TIMEZONE } from '@core/time/timezoneUtils'
import { parseOptionalSupportedCurrency, parseSupportedCurrency } from '@core/money/currencyUtils'
import { parseBudgetAmount } from './budgetUtils'
import { parseOptionalWorkspaceId } from '@core/access/workspace'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { resolveClientObjectId } from '@core/db/objectId'
import { validateRequiredFields } from '@core/http/validation'
import {
    PeriodBody,
    archiveBudget as archiveBudgetService,
    createBudget as createBudgetService,
    getBudget as getBudgetService,
    getBudgetProgress as getBudgetProgressService,
    listBudgets as listBudgetsService,
    updateBudget as updateBudgetService,
} from './budget.service'

const PERIOD_KEYS = ['periodType', 'year', 'month', 'periodStart', 'periodEnd'] as const

const getUserTimezone = (req: AuthRequest): string => req.user?.timezone?.trim() || DEFAULT_TIMEZONE

/** Copy only the period-shaping keys that are actually present on the body. */
const pickPeriodBody = (body: Record<string, unknown>): PeriodBody => {
    const picked: PeriodBody = {}
    for (const key of PERIOD_KEYS) {
        if (body[key] !== undefined) {
            picked[key] = body[key]
        }
    }
    return picked
}

const parseOptionalCategoryId = (categoryId: unknown): Types.ObjectId | null | undefined => {
    if (categoryId === undefined) {
        return undefined
    }
    if (categoryId === null || categoryId === '') {
        return null
    }
    if (typeof categoryId !== 'string') {
        throw new CustomError('categoryId must be a string or null for overall budgets', 400)
    }
    return new Types.ObjectId(categoryId)
}

const parseAccountIds = (accountIds: unknown): string[] | undefined => {
    if (accountIds === undefined) {
        return undefined
    }
    if (!Array.isArray(accountIds)) {
        throw new CustomError('accountIds must be an array', 400)
    }
    return accountIds.map(String)
}

const parseBudgetName = (name: unknown): string | undefined =>
    typeof name === 'string' ? name.trim() || undefined : undefined

export const createBudget = asyncHandler(async (req: AuthRequest, res: Response) => {
    validateRequiredFields(req.body, ['periodType', 'amount'])

    const serialized = await createBudgetService({
        userId: getUserId(req),
        timezone: getUserTimezone(req),
        periodBody: pickPeriodBody(req.body),
        amountMinor: parseBudgetAmount(req.body.amount),
        name: parseBudgetName(req.body.name),
        categoryId: parseOptionalCategoryId(req.body.categoryId) ?? null,
        workspaceId: parseOptionalWorkspaceId(req.body.workspaceId) ?? null,
        accountIds: parseAccountIds(req.body.accountIds) ?? [],
        currency: parseOptionalSupportedCurrency(req.body.currency),
        rollover: req.body.rollover === true,
        clientId: resolveClientObjectId(req.body._id) ?? null,
    })

    handleResponses(res, 201, serialized)
})

export const getBudgets = asyncHandler(async (req: AuthRequest, res: Response) => {
    const serialized = await listBudgetsService({
        userId: getUserId(req),
        workspaceId: parseOptionalWorkspaceId(req.query.workspaceId) ?? null,
        includeArchived: req.query.includeArchived === 'true',
        categoryId: req.query.categoryId !== undefined ? String(req.query.categoryId) : undefined,
        overallOnly: req.query.overall === 'true',
    })

    handleResponses(res, 200, serialized)
})

export const getBudgetById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { budgetId } = req.params
    validateRequiredFields({ budgetId }, ['budgetId'])

    handleResponses(res, 200, await getBudgetService(budgetId, getUserId(req)))
})

export const updateBudget = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { budgetId } = req.params
    validateRequiredFields({ budgetId }, ['budgetId'])

    const touchesPeriod =
        req.body.periodType !== undefined ||
        req.body.year !== undefined ||
        req.body.month !== undefined
    const touchesCustomPeriod =
        !touchesPeriod && (req.body.periodStart !== undefined || req.body.periodEnd !== undefined)

    const serialized = await updateBudgetService({
        budgetId,
        userId: getUserId(req),
        timezone: getUserTimezone(req),
        periodBody: touchesPeriod ? pickPeriodBody(req.body) : undefined,
        customPeriodPatch: touchesCustomPeriod
            ? {
                  periodStart:
                      req.body.periodStart !== undefined
                          ? String(req.body.periodStart)
                          : undefined,
                  periodEnd:
                      req.body.periodEnd !== undefined ? String(req.body.periodEnd) : undefined,
              }
            : undefined,
        amountMinor:
            req.body.amount !== undefined ? parseBudgetAmount(req.body.amount) : undefined,
        name:
            req.body.name !== undefined ? (parseBudgetName(req.body.name) ?? null) : undefined,
        currency:
            req.body.currency !== undefined
                ? parseSupportedCurrency(req.body.currency)
                : undefined,
        rollover: req.body.rollover !== undefined ? req.body.rollover === true : undefined,
        categoryId: parseOptionalCategoryId(req.body.categoryId),
        accountIds: parseAccountIds(req.body.accountIds),
    })

    handleResponses(res, 200, serialized)
})

export const archiveBudget = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { budgetId } = req.params
    validateRequiredFields({ budgetId }, ['budgetId'])

    const budget = await archiveBudgetService(budgetId, getUserId(req))
    handleResponses(res, 200, { message: 'Budget archived successfully', data: budget })
})

export const getBudgetProgress = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { budgetId } = req.params
    validateRequiredFields({ budgetId }, ['budgetId'])

    handleResponses(res, 200, await getBudgetProgressService(budgetId, getUserId(req)))
})
