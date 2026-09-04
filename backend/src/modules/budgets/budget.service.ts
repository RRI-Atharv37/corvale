import { Types } from 'mongoose'

import Budget, { IBudget } from './budget.model'
import {
    SerializedBudget,
    attachProgressToBudget,
    attachProgressToBudgets,
    resolveCustomPeriod,
    resolvePeriodFromBody,
    validateAccountIdsForBudget,
    validateCategoryForBudget,
} from './budgetUtils'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { buildScopedListFilter } from '@core/access/workspace'
import { isDuplicateKeyError } from '@core/db/objectId'
import { assertWorkspaceMembership, validateResourceAccess } from '@modules/workspaces/access'

/** Only the period-shaping keys, copied verbatim from the request body (present keys only). */
export type PeriodBody = Record<string, unknown>

export interface CreateBudgetInput {
    userId: string
    timezone: string
    periodBody: PeriodBody
    amountMinor: number
    name?: string
    categoryId: Types.ObjectId | null
    workspaceId: string | null
    accountIds: string[]
    currency?: string
    rollover: boolean
    clientId: Types.ObjectId | null
}

export const createBudget = async (input: CreateBudgetInput): Promise<SerializedBudget> => {
    const { periodStart, periodEnd, periodType } = resolvePeriodFromBody(
        input.periodBody,
        input.timezone
    )

    if (input.workspaceId) {
        await assertWorkspaceMembership(input.workspaceId, input.userId, 'editor')
    }

    const validatedAccountIds = await validateAccountIdsForBudget(
        input.accountIds,
        input.userId,
        input.workspaceId
    )

    if (input.categoryId) {
        await validateCategoryForBudget(input.categoryId.toString(), input.userId)
    }

    let budget: IBudget
    try {
        budget = await Budget.create({
            ...(input.clientId ? { _id: input.clientId } : {}),
            userId: input.userId,
            workspaceId: input.workspaceId,
            name: input.name,
            periodType,
            periodStart,
            periodEnd,
            categoryId: input.categoryId ?? null,
            amount: input.amountMinor,
            currency: input.currency,
            rollover: input.rollover,
            accountIds: validatedAccountIds,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('A budget with this id already exists', 400)
        }
        throw error
    }

    return attachProgressToBudget(budget)
}

export interface ListBudgetsInput {
    userId: string
    workspaceId: string | null
    includeArchived: boolean
    categoryId?: string
    overallOnly: boolean
}

export const listBudgets = async (input: ListBudgetsInput): Promise<SerializedBudget[]> => {
    if (input.workspaceId) {
        await assertWorkspaceMembership(input.workspaceId, input.userId, 'viewer')
    }

    const filter: Record<string, unknown> = buildScopedListFilter(input.userId, input.workspaceId)
    if (!input.includeArchived) {
        filter.isArchived = false
    }
    if (input.categoryId !== undefined && input.categoryId !== '') {
        filter.categoryId = new Types.ObjectId(input.categoryId)
    }
    if (input.overallOnly) {
        filter.categoryId = null
    }

    const budgets = await Budget.find(filter).sort({ periodStart: -1, createdAt: -1 })
    return attachProgressToBudgets(budgets)
}

const loadBudget = (
    budgetId: string,
    userId: string,
    minRole: 'viewer' | 'editor'
): Promise<IBudget> =>
    validateResourceAccess<IBudget>(
        Budget,
        budgetId,
        userId,
        ERROR_MESSAGES.BUDGET.BUDGET_NOT_FOUND,
        minRole
    )

export const getBudget = async (budgetId: string, userId: string): Promise<SerializedBudget> => {
    const budget = await loadBudget(budgetId, userId, 'viewer')
    return attachProgressToBudget(budget)
}

export const getBudgetProgress = async (budgetId: string, userId: string) => {
    const budget = await loadBudget(budgetId, userId, 'viewer')
    const serialized = await attachProgressToBudget(budget)
    return serialized.progress
}

export interface UpdateBudgetInput {
    budgetId: string
    userId: string
    timezone: string
    /** Present when the request touched periodType / year / month — resolved against the stored budget. */
    periodBody?: PeriodBody
    /** Present when the request touched only periodStart / periodEnd on a custom budget. */
    customPeriodPatch?: { periodStart?: string; periodEnd?: string }
    amountMinor?: number
    /** `undefined` = leave unchanged; `null` = clear the name. */
    name?: string | null
    currency?: string
    rollover?: boolean
    categoryId?: Types.ObjectId | null
    accountIds?: string[]
}

export const updateBudget = async (input: UpdateBudgetInput): Promise<SerializedBudget> => {
    const budget = await loadBudget(input.budgetId, input.userId, 'editor')

    if (budget.isArchived) {
        throw new CustomError(ERROR_MESSAGES.BUDGET.BUDGET_ARCHIVED, 400)
    }

    if (input.periodBody) {
        const { periodStart, periodEnd, periodType } = resolvePeriodFromBody(
            {
                periodType: budget.periodType,
                periodStart: budget.periodStart,
                periodEnd: budget.periodEnd,
                ...input.periodBody,
            },
            input.timezone
        )
        budget.periodType = periodType
        budget.periodStart = periodStart
        budget.periodEnd = periodEnd
    } else if (input.customPeriodPatch) {
        if (budget.periodType !== 'custom') {
            throw new CustomError(
                'periodStart and periodEnd can only be updated on custom budgets',
                400
            )
        }
        const startStr =
            input.customPeriodPatch.periodStart ?? budget.periodStart.toISOString().slice(0, 10)
        const endStr =
            input.customPeriodPatch.periodEnd ?? budget.periodEnd.toISOString().slice(0, 10)
        const { periodStart, periodEnd } = resolveCustomPeriod(startStr, endStr, input.timezone)
        budget.periodStart = periodStart
        budget.periodEnd = periodEnd
    }

    if (input.amountMinor !== undefined) {
        budget.amount = input.amountMinor
    }
    if (input.name !== undefined) {
        budget.name = input.name ?? undefined
    }
    if (input.currency !== undefined) {
        budget.currency = input.currency
    }
    if (input.rollover !== undefined) {
        budget.rollover = input.rollover
    }
    if (input.categoryId !== undefined) {
        if (input.categoryId) {
            await validateCategoryForBudget(input.categoryId.toString(), input.userId)
        }
        budget.categoryId = input.categoryId
    }
    if (input.accountIds !== undefined) {
        budget.accountIds = await validateAccountIdsForBudget(
            input.accountIds,
            input.userId,
            budget.workspaceId?.toString() ?? null
        )
    }

    const updated = await budget.save()
    return attachProgressToBudget(updated)
}

export const archiveBudget = async (budgetId: string, userId: string): Promise<IBudget> => {
    const budget = await loadBudget(budgetId, userId, 'editor')

    if (budget.isArchived) {
        throw new CustomError(ERROR_MESSAGES.BUDGET.BUDGET_ALREADY_ARCHIVED, 400)
    }

    budget.isArchived = true
    await budget.save()
    return budget
}
