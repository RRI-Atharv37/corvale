import type { LocalDb } from '../db/LocalDb'
import { Repository } from '../db/repositories/Repository'
import {
  computeDiscretionaryDailyAverage,
  projectGoalContributionDates,
  projectRecurringOccurrences,
  type LowBalanceWarning,
  type ProjectedChange,
} from '@shared/forecast'
import { fromMinorUnits, roundMoney } from '@shared/money'
import type { LocalAccount, LocalRecurringRule, LocalSavingsGoal, LocalTransaction } from './types'

const accountsRepo = new Repository<LocalAccount>('accounts')
const recurringRepo = new Repository<LocalRecurringRule>('recurringRules')
const goalsRepo = new Repository<LocalSavingsGoal>('savingsGoals')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

const SUPPORTED_DAYS = [30, 60, 90]
const DISCRETIONARY_LOOKBACK_DAYS = 90

/**
 * `LocalSavingsGoal` (domain/types.ts) has no `accountId` field yet - it round-trips fine through
 * the JSON `data` blob (Repository stores the full doc), this just widens the local type so this
 * module can filter goals by their linked account, mirroring the pattern established in
 * `pages/Dashboard/hooks/useSavingsGoalsData.ts`.
 */
interface LocalSavingsGoalRecord extends LocalSavingsGoal {
  accountId?: string | null
}

/**
 * `LocalTransaction` has no `recurringPaymentId` field yet - same "round-trips through the JSON
 * blob, widen locally rather than touch shared infra" pattern - needed to exclude recurring-linked
 * transactions from the discretionary spend average, mirroring `forecastController.ts`'s
 * `recurringPaymentId: null` match condition.
 */
interface LocalTransactionRecord extends LocalTransaction {
  recurringPaymentId?: string | null
}

export type { ForecastChangeType } from '@shared/forecast'
export type LocalForecastChange = ProjectedChange

export interface LocalForecastAccount {
  accountId: string
  accountName: string
  currency: string
  startingBalance: number
  projectedEndingBalance: number
  projectedChanges: LocalForecastChange[]
  lowBalanceWarnings: LowBalanceWarning[]
}

export interface LocalForecastResponse {
  days: number
  startDate: string
  endDate: string
  accounts: LocalForecastAccount[]
}

export interface ForecastLocalOptions {
  days: number
  accountId?: string
  workspaceId?: string | null
}

const formatDateOnly = (date: Date): string => date.toISOString().slice(0, 10)

/** Local counterpart to `forecastController.ts`'s `projectAccountForecast`, given the already-scoped rule/goal/transaction rows for one account. */
const projectAccountForecast = (
  account: LocalAccount,
  rules: LocalRecurringRule[],
  goals: LocalSavingsGoalRecord[],
  transactions: LocalTransactionRecord[],
  rangeStart: Date,
  rangeEnd: Date,
  days: number
): LocalForecastAccount => {
  const changes: ProjectedChange[] = []

  for (const rule of rules) {
    const occurrences = projectRecurringOccurrences(
      {
        nextDueDate: new Date(rule.nextDueDate),
        interval: rule.interval,
        customIntervalDays: rule.customIntervalDays,
      },
      rangeStart,
      rangeEnd
    )
    for (const date of occurrences) {
      changes.push({
        date: formatDateOnly(date),
        type: 'recurring',
        amount: rule.type === 'income' ? fromMinorUnits(rule.amount) : -fromMinorUnits(rule.amount),
        label: rule.title,
        refId: rule._id,
      })
    }
  }

  for (const goal of goals) {
    const occurrences = projectGoalContributionDates(
      {
        enabled: goal.autoContribution.enabled,
        amount: goal.autoContribution.amount,
        interval: goal.autoContribution.interval,
        lastContributedAt: goal.autoContribution.lastContributedAt
          ? new Date(goal.autoContribution.lastContributedAt)
          : undefined,
      },
      rangeStart,
      rangeEnd
    )
    for (const date of occurrences) {
      changes.push({
        date: formatDateOnly(date),
        type: 'goal',
        amount: -fromMinorUnits(goal.autoContribution.amount),
        label: goal.name,
        refId: goal._id,
      })
    }
  }

  const lookbackStart = new Date(rangeStart)
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - DISCRETIONARY_LOOKBACK_DAYS)

  // Mirrors the server's Transaction.aggregate match: expense + posted + non-recurring-linked +
  // in the trailing lookback window, scoped to this account. No `splitTransactionId` filter here,
  // matching the server's discretionary aggregate exactly (it counts split parents and children
  // both, unlike the list/balance paths).
  let discretionaryTotalMinor = 0
  for (const tx of transactions) {
    if (tx.accountId !== account._id) continue
    if (tx.type !== 'expense' || tx.status !== 'posted') continue
    if (tx.recurringPaymentId) continue
    const date = new Date(tx.date)
    if (date < lookbackStart || date >= rangeStart) continue
    discretionaryTotalMinor += tx.amount
  }

  const dailyAverageMinor = computeDiscretionaryDailyAverage(discretionaryTotalMinor, DISCRETIONARY_LOOKBACK_DAYS)

  if (dailyAverageMinor > 0) {
    changes.push({
      date: formatDateOnly(rangeEnd),
      type: 'discretionary',
      amount: -fromMinorUnits(dailyAverageMinor * days),
      label: 'Projected discretionary spending',
    })
  }

  changes.sort((a, b) => a.date.localeCompare(b.date))

  let runningBalance = account.currentBalance
  const lowBalanceWarnings: LowBalanceWarning[] = []

  for (const change of changes) {
    runningBalance = roundMoney(runningBalance + change.amount)
    if (runningBalance < 0) {
      lowBalanceWarnings.push({ date: change.date, projectedBalance: runningBalance })
    }
  }

  return {
    accountId: account._id,
    accountName: account.name,
    currency: account.currency,
    startingBalance: account.currentBalance,
    projectedEndingBalance: runningBalance,
    projectedChanges: changes,
    lowBalanceWarnings,
  }
}

/** Local counterpart to `GET /forecast`. */
export const computeLocalForecast = async (
  db: LocalDb,
  options: ForecastLocalOptions
): Promise<LocalForecastResponse> => {
  const { days, accountId } = options
  const workspaceId = options.workspaceId ?? null

  if (!SUPPORTED_DAYS.includes(days)) {
    throw new Error(`Invalid days; must be one of ${SUPPORTED_DAYS.join(', ')}`)
  }

  const [allAccounts, allRules, allGoals, allTransactions] = await Promise.all([
    accountsRepo.list(db),
    recurringRepo.list(db),
    goalsRepo.list(db) as Promise<LocalSavingsGoalRecord[]>,
    transactionsRepo.list(db) as Promise<LocalTransactionRecord[]>,
  ])

  let accounts: LocalAccount[]
  if (accountId) {
    const account = allAccounts.find((a) => a._id === accountId)
    if (!account) {
      throw new Error('Account not found')
    }
    accounts = [account]
  } else {
    accounts = allAccounts.filter(
      (a) => !a.isArchived && (workspaceId ? a.workspaceId === workspaceId : !a.workspaceId)
    )
  }

  const now = new Date()
  const rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const rangeEnd = new Date(rangeStart)
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + days)

  const accountResults = accounts.map((account) => {
    const rules = allRules.filter((r) => r.accountId === account._id && r.isActive && !r.isArchived)
    const goals = allGoals.filter(
      (g) => g.accountId === account._id && g.status === 'active' && g.autoContribution.enabled
    )
    return projectAccountForecast(account, rules, goals, allTransactions, rangeStart, rangeEnd, days)
  })

  return {
    days,
    startDate: formatDateOnly(rangeStart),
    endDate: formatDateOnly(rangeEnd),
    accounts: accountResults,
  }
}
