import { Types } from 'mongoose'

import Budget, { IBudget } from '../models/Budget'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { parseOptionalSupportedCurrency, parseSupportedCurrency } from '@core/money/currencyUtils'
import {
    parseBudgetAmount,
    parsePeriodType,
    resolveCustomPeriod,
    resolveMonthlyPeriod,
    validateAccountIdsForBudget,
    validateCategoryForBudget,
} from '../utils/budgetUtils'
import { assertWorkspaceMembership, parseOptionalWorkspaceId, validateResourceAccess } from '@core/access/workspace'
import { archiveEntityForOp, DeleteOpOutcome, getUserTimezoneForOp } from './syncEntityHelpers'
import { fromMinorUnits } from '@shared/money'
import { isDuplicateKeyError, resolveClientObjectId } from '@core/db/objectId'
import { validateRequiredFields } from '@core/http/validation'

/**
 * `parseBudgetAmount` (like every other entity's amount parser) expects a
 * REST body's major-unit decimal and converts it to minor units itself. Sync
 * payloads carry `amount` already in minor units (the local SQLite/Budget
 * schema convention) — mirrors the `transaction.create` conversion already
 * in `syncController.ts`'s `applyCreateOp`, applied here for the same reason.
 */
const toMajorAmount = (value: unknown): unknown => (typeof value === 'number' ? fromMinorUnits(value) : value)

/**
 * Sprint 13.9: create/update/delete logic for POST /sync/push, mirroring
 * budgetController's createBudget/updateBudget/archiveBudget exactly. Period
 * resolution is timezone-sensitive; unlike the REST controller (which reads
 * `req.user.timezone`), this looks the caller's timezone up directly via
 * getUserTimezoneForOp since sync ops have no request-scoped user object.
 */

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

export const createBudgetForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<IBudget> => {
    validateRequiredFields(payload, ['periodType', 'amount'])

    const timezone = await getUserTimezoneForOp(userId)
    const { periodStart, periodEnd, periodType } = resolvePeriodFromBody(payload, timezone)
    const amountMinor = parseBudgetAmount(toMajorAmount(payload.amount))
    const categoryId = parseOptionalCategoryId(payload.categoryId)
    const workspaceId = parseOptionalWorkspaceId(payload.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'editor')
    }

    const accountIdStrings = parseAccountIds(payload.accountIds) ?? []
    const validatedAccountIds = await validateAccountIdsForBudget(accountIdStrings, userId, workspaceId)

    if (categoryId) {
        await validateCategoryForBudget(categoryId.toString(), userId)
    }

    const currency = parseOptionalSupportedCurrency(payload.currency)
    const clientId = resolveClientObjectId(payload._id)

    try {
        return await Budget.create({
            ...(clientId ? { _id: clientId } : {}),
            userId,
            workspaceId,
            name: typeof payload.name === 'string' ? payload.name.trim() || undefined : undefined,
            periodType,
            periodStart,
            periodEnd,
            categoryId: categoryId ?? null,
            amount: amountMinor,
            currency,
            rollover: payload.rollover === true,
            accountIds: validatedAccountIds,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('A budget with this id already exists', 400)
        }
        throw error
    }
}

export const updateBudgetForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<IBudget> => {
    const budgetId = payload._id
    if (typeof budgetId !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

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

    const timezone = await getUserTimezoneForOp(userId)

    if (payload.periodType !== undefined || payload.year !== undefined || payload.month !== undefined) {
        const { periodStart, periodEnd, periodType } = resolvePeriodFromBody(
            { ...budget.toObject(), ...payload },
            timezone
        )
        budget.periodType = periodType
        budget.periodStart = periodStart
        budget.periodEnd = periodEnd
    } else if (payload.periodStart !== undefined || payload.periodEnd !== undefined) {
        if (budget.periodType !== 'custom') {
            throw new CustomError('periodStart and periodEnd can only be updated on custom budgets', 400)
        }
        const startStr = String(payload.periodStart ?? budget.periodStart.toISOString().slice(0, 10))
        const endStr = String(payload.periodEnd ?? budget.periodEnd.toISOString().slice(0, 10))
        const { periodStart, periodEnd } = resolveCustomPeriod(startStr, endStr, timezone)
        budget.periodStart = periodStart
        budget.periodEnd = periodEnd
    }

    if (payload.amount !== undefined) {
        budget.amount = parseBudgetAmount(toMajorAmount(payload.amount))
    }

    if (payload.name !== undefined) {
        budget.name = typeof payload.name === 'string' ? payload.name.trim() || undefined : undefined
    }

    if (payload.currency !== undefined) {
        budget.currency = parseSupportedCurrency(payload.currency)
    }

    if (payload.rollover !== undefined) {
        budget.rollover = payload.rollover === true
    }

    const categoryId = parseOptionalCategoryId(payload.categoryId)
    if (categoryId !== undefined) {
        if (categoryId) {
            await validateCategoryForBudget(categoryId.toString(), userId)
        }
        budget.categoryId = categoryId
    }

    const accountIdStrings = parseAccountIds(payload.accountIds)
    if (accountIdStrings !== undefined) {
        budget.accountIds = await validateAccountIdsForBudget(
            accountIdStrings,
            userId,
            budget.workspaceId?.toString() ?? null
        )
    }

    return budget.save()
}

export const deleteBudgetForOp = (
    userId: string,
    payload: Record<string, unknown>
): Promise<DeleteOpOutcome> =>
    archiveEntityForOp(
        Budget,
        userId,
        payload,
        ERROR_MESSAGES.BUDGET.BUDGET_NOT_FOUND,
        (doc) => doc.isArchived,
        (doc) => {
            doc.isArchived = true
        }
    )
