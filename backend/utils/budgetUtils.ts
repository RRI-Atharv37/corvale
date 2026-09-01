import { Types } from 'mongoose'

import Account from '../models/Account'
import { BUDGET_PERIOD_TYPES, BudgetPeriodType, IBudget } from '../models/Budget'
import Category, { ICategory } from '../models/Category'
import Transaction from '../models/Transaction'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'
import { fromMinorUnits, parseAmountToMinorUnits } from './moneyUtils'
import { isMasterCategory } from './categorySeed'
import {
    BudgetProgress,
    computeBudgetProgress,
    resolveCustomPeriod as sharedResolveCustomPeriod,
    resolveMonthlyPeriod as sharedResolveMonthlyPeriod,
} from '@shared/budget'

export type { BudgetProgress }
export { computeBudgetProgress }

export interface SerializedBudget {
    _id: Types.ObjectId
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
    name?: string
    periodType: BudgetPeriodType
    periodStart: Date
    periodEnd: Date
    categoryId?: Types.ObjectId | null
    amount: number
    currency: string
    rollover: boolean
    accountIds: Types.ObjectId[]
    isArchived: boolean
    createdAt: Date
    updatedAt: Date
    progress?: BudgetProgress
}

export const parseBudgetAmount = (value: unknown): number => {
    try {
        const minor = parseAmountToMinorUnits(value)
        if (minor <= 0) {
            throw new Error('Amount must be greater than zero')
        }
        return minor
    } catch {
        throw new CustomError('Invalid budget amount; must be a positive number', 400)
    }
}

export const resolveMonthlyPeriod = (
    year: number,
    month: number,
    timezone: string
): { periodStart: Date; periodEnd: Date } => {
    if (!Number.isInteger(year) || year < 1970 || year > 9999) {
        throw new CustomError('Invalid year for monthly budget', 400)
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw new CustomError('Invalid month for monthly budget; must be 1–12', 400)
    }

    return sharedResolveMonthlyPeriod(year, month, timezone)
}

export const resolveCustomPeriod = (
    periodStart: string,
    periodEnd: string,
    timezone: string
): { periodStart: Date; periodEnd: Date } => {
    try {
        return sharedResolveCustomPeriod(periodStart, periodEnd, timezone)
    } catch {
        throw new CustomError(
            'Invalid custom period; use YYYY-MM-DD dates with start on or before end',
            400
        )
    }
}

export const parsePeriodType = (value: unknown): BudgetPeriodType => {
    if (typeof value !== 'string' || !BUDGET_PERIOD_TYPES.includes(value as BudgetPeriodType)) {
        throw new CustomError(
            `Invalid periodType. Must be one of: ${BUDGET_PERIOD_TYPES.join(', ')}`,
            400
        )
    }
    return value as BudgetPeriodType
}

export const validateCategoryForBudget = async (
    categoryId: string,
    userId: string
): Promise<ICategory> => {
    const category = await Category.findById(categoryId)
    if (!category) {
        throw new CustomError(ERROR_MESSAGES.CATEGORY.CATEGORY_NOT_FOUND, 404)
    }
    if (category.isArchived) {
        throw new CustomError(ERROR_MESSAGES.CATEGORY.CATEGORY_ARCHIVED, 400)
    }
    if (isMasterCategory(category)) {
        return category
    }
    if (category.userId?.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }
    return category
}

export const validateAccountIdsForBudget = async (
    accountIds: string[],
    userId: string,
    workspaceId?: string | null
): Promise<Types.ObjectId[]> => {
    if (accountIds.length === 0) {
        return []
    }

    const uniqueIds = [...new Set(accountIds)]
    const filter: Record<string, unknown> = {
        _id: { $in: uniqueIds },
        isArchived: false,
    }

    if (workspaceId) {
        filter.workspaceId = new Types.ObjectId(workspaceId)
    } else {
        filter.userId = new Types.ObjectId(userId)
        filter.workspaceId = null
    }

    const accounts = await Account.find(filter)

    if (accounts.length !== uniqueIds.length) {
        throw new CustomError(ERROR_MESSAGES.BUDGET.INVALID_ACCOUNT_IDS, 400)
    }

    return accounts.map((account) => account._id)
}

const buildAccountFilter = (accountIds: Types.ObjectId[]): Record<string, unknown> => {
    if (accountIds.length === 0) {
        return {}
    }
    return { accountId: { $in: accountIds } }
}

/** Sum posted expense minor units that count toward a budget. Excludes drafts and transfers. */
export const computeBudgetSpentMinor = async (budget: IBudget): Promise<number> => {
    const scopeFilter = budget.workspaceId
        ? { workspaceId: budget.workspaceId }
        : { userId: budget.userId, workspaceId: null }

    const baseFilter: Record<string, unknown> = {
        ...scopeFilter,
        type: 'expense',
        status: 'posted',
        date: { $gte: budget.periodStart, $lte: budget.periodEnd },
        ...buildAccountFilter(budget.accountIds),
    }

    if (budget.categoryId) {
        const splitParentIds = await Transaction.distinct('splitTransactionId', {
            ...scopeFilter,
            splitTransactionId: { $ne: null },
        })

        const categoryMatch: Record<string, unknown> = {
            $or: [
                { categoryId: budget.categoryId, splitTransactionId: { $ne: null } },
                {
                    categoryId: budget.categoryId,
                    splitTransactionId: null,
                    _id: { $nin: splitParentIds },
                },
            ],
        }

        const result = await Transaction.aggregate([
            { $match: { ...baseFilter, ...categoryMatch } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ])

        return result[0]?.total ?? 0
    }

    const result = await Transaction.aggregate([
        {
            $match: {
                ...baseFilter,
                splitTransactionId: null,
            },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
    ])

    return result[0]?.total ?? 0
}

export const serializeBudget = (
    budget: IBudget,
    progress?: BudgetProgress
): SerializedBudget => {
    return {
        ...(budget.toObject() as SerializedBudget),
        amount: fromMinorUnits(budget.amount),
        progress,
    }
}

export const attachProgressToBudget = async (budget: IBudget): Promise<SerializedBudget> => {
    const spentMinor = await computeBudgetSpentMinor(budget)
    const progress = computeBudgetProgress(budget.amount, spentMinor)
    return serializeBudget(budget, progress)
}

export const attachProgressToBudgets = async (budgets: IBudget[]): Promise<SerializedBudget[]> => {
    return Promise.all(budgets.map((budget) => attachProgressToBudget(budget)))
}

