import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import Account, { IAccount } from '../models/Account'
import RecurringRule from '../models/RecurringRule'
import SavingsGoal from '../models/SavingsGoal'
import Transaction from '../models/Transaction'
import { AuthRequest } from '@core/auth/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    computeDiscretionaryDailyAverage,
    LowBalanceWarning,
    ProjectedChange,
    projectGoalContributionDates,
    projectRecurringOccurrences,
} from '../utils/forecastUtils'
import { fromMinorUnits } from '@core/money/moneyUtils'
import {
    assertWorkspaceMembership,
    buildScopedListFilter,
    parseOptionalWorkspaceId,
    validateResourceAccess,
} from '@core/access/workspace'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'

const SUPPORTED_DAYS = [30, 60, 90]
const DISCRETIONARY_LOOKBACK_DAYS = 90

const formatDateOnly = (date: Date): string => date.toISOString().slice(0, 10)

const parseDays = (value: unknown): number => {
    if (value === undefined) {
        return 30
    }
    const days = Number(value)
    if (!SUPPORTED_DAYS.includes(days)) {
        throw new CustomError(`Invalid days; must be one of ${SUPPORTED_DAYS.join(', ')}`, 400)
    }
    return days
}

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100

const buildAccountScopeFilter = (account: IAccount): Record<string, unknown> => {
    return account.workspaceId
        ? { workspaceId: account.workspaceId }
        : { userId: account.userId, workspaceId: null }
}

const projectAccountForecast = async (
    account: IAccount,
    rangeStart: Date,
    rangeEnd: Date,
    days: number
) => {
    const scopeFilter = buildAccountScopeFilter(account)
    const changes: ProjectedChange[] = []

    const rules = await RecurringRule.find({
        ...scopeFilter,
        accountId: account._id,
        isActive: true,
        isArchived: false,
    })

    for (const rule of rules) {
        const occurrences = projectRecurringOccurrences(rule, rangeStart, rangeEnd)
        for (const date of occurrences) {
            changes.push({
                date: formatDateOnly(date),
                type: 'recurring',
                amount: rule.type === 'income' ? fromMinorUnits(rule.amount) : -fromMinorUnits(rule.amount),
                label: rule.title,
                refId: rule._id.toString(),
            })
        }
    }

    const goals = await SavingsGoal.find({
        ...scopeFilter,
        accountId: account._id,
        status: 'active',
        'autoContribution.enabled': true,
    })

    for (const goal of goals) {
        const occurrences = projectGoalContributionDates(goal.autoContribution, rangeStart, rangeEnd)
        for (const date of occurrences) {
            changes.push({
                date: formatDateOnly(date),
                type: 'goal',
                amount: -fromMinorUnits(goal.autoContribution.amount),
                label: goal.name,
                refId: goal._id.toString(),
            })
        }
    }

    const lookbackStart = new Date(rangeStart)
    lookbackStart.setUTCDate(lookbackStart.getUTCDate() - DISCRETIONARY_LOOKBACK_DAYS)

    const discretionaryResult = await Transaction.aggregate([
        {
            $match: {
                ...scopeFilter,
                accountId: account._id,
                type: 'expense',
                status: 'posted',
                recurringPaymentId: null,
                date: { $gte: lookbackStart, $lt: rangeStart },
            },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
    ])
    const discretionaryTotalMinor = discretionaryResult[0]?.total ?? 0
    const dailyAverageMinor = computeDiscretionaryDailyAverage(
        discretionaryTotalMinor,
        DISCRETIONARY_LOOKBACK_DAYS
    )

    if (dailyAverageMinor > 0) {
        changes.push({
            date: formatDateOnly(rangeEnd),
            type: 'discretionary',
            amount: -fromMinorUnits(dailyAverageMinor * days),
            label: 'Projected discretionary spending',
        })
    }

    changes.sort((a, b) => a.date.localeCompare(b.date))

    const startingBalance =
        account.balanceUnit === 'minor' ? fromMinorUnits(account.currentBalance) : account.currentBalance
    let runningBalance = startingBalance
    const lowBalanceWarnings: LowBalanceWarning[] = []

    for (const change of changes) {
        runningBalance = roundMoney(runningBalance + change.amount)
        if (runningBalance < 0) {
            lowBalanceWarnings.push({ date: change.date, projectedBalance: runningBalance })
        }
    }

    return {
        accountId: account._id.toString(),
        accountName: account.name,
        currency: account.currency,
        startingBalance,
        projectedEndingBalance: runningBalance,
        projectedChanges: changes,
        lowBalanceWarnings,
    }
}

export const getForecast = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const days = parseDays(req.query.days)
    const workspaceId = parseOptionalWorkspaceId(req.query.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'viewer')
    }

    let accounts: IAccount[]

    if (req.query.accountId) {
        const account = await validateResourceAccess(
            Account,
            req.query.accountId as string,
            userId,
            ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
            'viewer'
        )
        accounts = [account]
    } else {
        const filter: Record<string, unknown> = {
            ...buildScopedListFilter(userId, workspaceId),
            isArchived: false,
        }
        accounts = await Account.find(filter)
    }

    const now = new Date()
    const rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const rangeEnd = new Date(rangeStart)
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + days)

    const accountResults = await Promise.all(
        accounts.map((account) => projectAccountForecast(account, rangeStart, rangeEnd, days))
    )

    handleResponses(res, 200, {
        days,
        startDate: formatDateOnly(rangeStart),
        endDate: formatDateOnly(rangeEnd),
        accounts: accountResults,
    })
})
