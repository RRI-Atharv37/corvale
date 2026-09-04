import { IAccount, Account } from '@modules/accounts'
import { RecurringRule } from '@modules/recurring'
import { SavingsGoal } from '@modules/savings-goals'
import { Transaction } from '@modules/transactions'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    LowBalanceWarning,
    ProjectedChange,
    computeDiscretionaryDailyAverage,
    projectGoalContributionDates,
    projectRecurringOccurrences,
} from './forecastUtils'
import { fromMinorUnits, roundMoney } from '@core/money/moneyUtils'
import { buildScopedListFilter } from '@core/access/workspace'
import { assertWorkspaceMembership, validateResourceAccess } from '@modules/workspaces/access'

const DISCRETIONARY_LOOKBACK_DAYS = 90

const formatDateOnly = (date: Date): string => date.toISOString().slice(0, 10)

const buildAccountScopeFilter = (account: IAccount): Record<string, unknown> =>
    account.workspaceId
        ? { workspaceId: account.workspaceId }
        : { userId: account.userId, workspaceId: null }

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
        for (const date of projectRecurringOccurrences(rule, rangeStart, rangeEnd)) {
            changes.push({
                date: formatDateOnly(date),
                type: 'recurring',
                amount:
                    rule.type === 'income'
                        ? fromMinorUnits(rule.amount)
                        : -fromMinorUnits(rule.amount),
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
        for (const date of projectGoalContributionDates(
            goal.autoContribution,
            rangeStart,
            rangeEnd
        )) {
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
        account.balanceUnit === 'minor'
            ? fromMinorUnits(account.currentBalance)
            : account.currentBalance
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

export interface ForecastInput {
    userId: string
    days: number
    workspaceId: string | null
    accountId?: string
}

export const buildForecast = async (input: ForecastInput) => {
    if (input.workspaceId) {
        await assertWorkspaceMembership(input.workspaceId, input.userId, 'viewer')
    }

    let accounts: IAccount[]
    if (input.accountId) {
        const account = await validateResourceAccess<IAccount>(
            Account,
            input.accountId,
            input.userId,
            ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
            'viewer'
        )
        accounts = [account]
    } else {
        accounts = await Account.find({
            ...buildScopedListFilter(input.userId, input.workspaceId),
            isArchived: false,
        })
    }

    const now = new Date()
    const rangeStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    )
    const rangeEnd = new Date(rangeStart)
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + input.days)

    const accountResults = await Promise.all(
        accounts.map((account) => projectAccountForecast(account, rangeStart, rangeEnd, input.days))
    )

    return {
        days: input.days,
        startDate: formatDateOnly(rangeStart),
        endDate: formatDateOnly(rangeEnd),
        accounts: accountResults,
    }
}
