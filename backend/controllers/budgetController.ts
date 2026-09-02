import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import Budget, { IBudget } from '../models/Budget'
import { AuthRequest } from '@core/auth/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { DEFAULT_TIMEZONE } from '@core/time/timezoneUtils'
import { parseOptionalSupportedCurrency, parseSupportedCurrency } from '@core/money/currencyUtils'
import {
    attachProgressToBudget,
    attachProgressToBudgets,
    parseBudgetAmount,
    parsePeriodType,
    resolveCustomPeriod,
    resolveMonthlyPeriod,
    validateAccountIdsForBudget,
    validateCategoryForBudget,
} from '../utils/budgetUtils'
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

const getUserTimezone = (req: AuthRequest): string => {
    return req.user?.timezone?.trim() || DEFAULT_TIMEZONE
}

const resolvePeriodFromBody = (
    body: Record<string, unknown>,
    timezone: string
): { periodStart: Date; periodEnd: Date; periodType: 'monthly' | 'custom' } => {
    const periodType = parsePeriodType(body.periodType)

    if (periodType === 'monthly') {
        validateRequiredFields(body, ['year', 'month'])
        const year = Number(body.year)
        const month = Number(body.month)
        const { periodStart, periodEnd } = resolveMonthlyPeriod(year, month, timezone)
        return { periodStart, periodEnd, periodType }
    }

    validateRequiredFields(body, ['periodStart', 'periodEnd'])
    const { periodStart, periodEnd } = resolveCustomPeriod(
        String(body.periodStart),
        String(body.periodEnd),
        timezone
    )
    return { periodStart, periodEnd, periodType }
}

const parseOptionalCategoryId = (
    categoryId: unknown
): Types.ObjectId | null | undefined => {
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

export const createBudget = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)

    validateRequiredFields(req.body, ['periodType', 'amount'])

    const { periodStart, periodEnd, periodType } = resolvePeriodFromBody(req.body, timezone)
    const amountMinor = parseBudgetAmount(req.body.amount)
    const categoryId = parseOptionalCategoryId(req.body.categoryId)
    const workspaceId = parseOptionalWorkspaceId(req.body.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'editor')
    }

    const accountIdStrings = parseAccountIds(req.body.accountIds) ?? []
    const validatedAccountIds = await validateAccountIdsForBudget(
        accountIdStrings,
        userId,
        workspaceId
    )

    if (categoryId) {
        await validateCategoryForBudget(categoryId.toString(), userId)
    }

    const currency = parseOptionalSupportedCurrency(req.body.currency)
    const clientId = resolveClientObjectId(req.body._id)

    let budget
    try {
        budget = await Budget.create({
            ...(clientId ? { _id: clientId } : {}),
            userId,
            workspaceId,
            name: typeof req.body.name === 'string' ? req.body.name.trim() || undefined : undefined,
            periodType,
            periodStart,
            periodEnd,
            categoryId: categoryId ?? null,
            amount: amountMinor,
            currency,
            rollover: req.body.rollover === true,
            accountIds: validatedAccountIds,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('A budget with this id already exists', 400)
        }
        throw error
    }

    const serialized = await attachProgressToBudget(budget)
    handleResponses(res, 201, serialized)
})

export const getBudgets = asyncHandler(async (req: AuthRequest, res: Response) => {
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

    if (req.query.categoryId !== undefined && req.query.categoryId !== '') {
        filter.categoryId = new Types.ObjectId(String(req.query.categoryId))
    }

    if (req.query.overall === 'true') {
        filter.categoryId = null
    }

    const budgets = await Budget.find(filter).sort({ periodStart: -1, createdAt: -1 })
    const serialized = await attachProgressToBudgets(budgets)

    handleResponses(res, 200, serialized)
})

export const getBudgetById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { budgetId } = req.params

    validateRequiredFields({ budgetId }, ['budgetId'])

    const budget = await validateResourceAccess<IBudget>(
        Budget,
        budgetId,
        userId,
        ERROR_MESSAGES.BUDGET.BUDGET_NOT_FOUND,
        'viewer'
    )

    const serialized = await attachProgressToBudget(budget)
    handleResponses(res, 200, serialized)
})

export const updateBudget = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { budgetId } = req.params

    validateRequiredFields({ budgetId }, ['budgetId'])

    const budget = await validateResourceAccess<IBudget>(
        Budget,
        budgetId,
        userId,
        ERROR_MESSAGES.BUDGET.BUDGET_NOT_FOUND,
        'editor'
    )

    if (budget.isArchived) {
        throw new CustomError(ERROR_MESSAGES.BUDGET.BUDGET_ARCHIVED, 400)
    }

    if (req.body.periodType !== undefined || req.body.year !== undefined || req.body.month !== undefined) {
        const { periodStart, periodEnd, periodType } = resolvePeriodFromBody(
            { ...budget.toObject(), ...req.body },
            timezone
        )
        budget.periodType = periodType
        budget.periodStart = periodStart
        budget.periodEnd = periodEnd
    } else if (req.body.periodStart !== undefined || req.body.periodEnd !== undefined) {
        if (budget.periodType !== 'custom') {
            throw new CustomError(
                'periodStart and periodEnd can only be updated on custom budgets',
                400
            )
        }
        const startStr = String(req.body.periodStart ?? budget.periodStart.toISOString().slice(0, 10))
        const endStr = String(req.body.periodEnd ?? budget.periodEnd.toISOString().slice(0, 10))
        const { periodStart, periodEnd } = resolveCustomPeriod(startStr, endStr, timezone)
        budget.periodStart = periodStart
        budget.periodEnd = periodEnd
    }

    if (req.body.amount !== undefined) {
        budget.amount = parseBudgetAmount(req.body.amount)
    }

    if (req.body.name !== undefined) {
        budget.name = typeof req.body.name === 'string' ? req.body.name.trim() || undefined : undefined
    }

    if (req.body.currency !== undefined) {
        budget.currency = parseSupportedCurrency(req.body.currency)
    }

    if (req.body.rollover !== undefined) {
        budget.rollover = req.body.rollover === true
    }

    const categoryId = parseOptionalCategoryId(req.body.categoryId)
    if (categoryId !== undefined) {
        if (categoryId) {
            await validateCategoryForBudget(categoryId.toString(), userId)
        }
        budget.categoryId = categoryId
    }

    const accountIdStrings = parseAccountIds(req.body.accountIds)
    if (accountIdStrings !== undefined) {
        budget.accountIds = await validateAccountIdsForBudget(
            accountIdStrings,
            userId,
            budget.workspaceId?.toString() ?? null
        )
    }

    const updatedBudget = await budget.save()
    const serialized = await attachProgressToBudget(updatedBudget)
    handleResponses(res, 200, serialized)
})

export const archiveBudget = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { budgetId } = req.params

    validateRequiredFields({ budgetId }, ['budgetId'])

    const budget = await validateResourceAccess<IBudget>(
        Budget,
        budgetId,
        userId,
        ERROR_MESSAGES.BUDGET.BUDGET_NOT_FOUND,
        'editor'
    )

    if (budget.isArchived) {
        throw new CustomError(ERROR_MESSAGES.BUDGET.BUDGET_ALREADY_ARCHIVED, 400)
    }

    budget.isArchived = true
    await budget.save()

    handleResponses(res, 200, { message: 'Budget archived successfully', data: budget })
})

export const getBudgetProgress = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { budgetId } = req.params

    validateRequiredFields({ budgetId }, ['budgetId'])

    const budget = await validateResourceAccess<IBudget>(
        Budget,
        budgetId,
        userId,
        ERROR_MESSAGES.BUDGET.BUDGET_NOT_FOUND,
        'viewer'
    )

    const serialized = await attachProgressToBudget(budget)
    handleResponses(res, 200, serialized.progress)
})
