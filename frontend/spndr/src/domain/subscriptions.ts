import type { LocalDb } from '../db/LocalDb'
import { Repository } from '../db/repositories/Repository'
import { computeAnnualCostMinor, computeMonthlyCostMinor, isSubscriptionEligible } from '@shared/subscriptions'
import { fromMinorUnits, roundMoney } from '@shared/money'
import type { RecurringInterval } from '@shared/types'
import type { LocalRecurringRule } from './types'

const recurringRepo = new Repository<LocalRecurringRule>('recurringRules')

export interface LocalSubscription {
  ruleId: string
  title: string
  amount: number
  currency: string
  interval: RecurringInterval
  monthlyCost: number
  annualCost: number
  nextChargeDate: string
  categoryId: string
  accountId: string
  isCancelled: boolean
}

export interface LocalSubscriptionsResponse {
  subscriptions: LocalSubscription[]
  totalMonthlyCost: number
  totalAnnualCost: number
}

export interface SubscriptionsLocalOptions {
  workspaceId?: string | null
}

const formatDateOnly = (date: Date): string => date.toISOString().slice(0, 10)

/** Local counterpart to `GET /subscriptions`. */
export const computeLocalSubscriptions = async (
  db: LocalDb,
  options: SubscriptionsLocalOptions = {}
): Promise<LocalSubscriptionsResponse> => {
  const workspaceId = options.workspaceId ?? null
  const rules = await recurringRepo.list(db)

  const eligible = rules
    .filter((rule) => (workspaceId ? rule.workspaceId === workspaceId : !rule.workspaceId))
    .filter((rule) =>
      isSubscriptionEligible({
        type: rule.type,
        isActive: rule.isActive,
        isArchived: rule.isArchived,
        interval: rule.interval,
      })
    )
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate))

  let totalMonthlyCost = 0
  let totalAnnualCost = 0

  const subscriptions: LocalSubscription[] = eligible.map((rule) => {
    const monthlyCostMinor = computeMonthlyCostMinor(rule.amount, rule.interval)
    const annualCostMinor = computeAnnualCostMinor(rule.amount, rule.interval)

    if (!rule.isCancelled) {
      totalMonthlyCost = roundMoney(totalMonthlyCost + fromMinorUnits(monthlyCostMinor))
      totalAnnualCost = roundMoney(totalAnnualCost + fromMinorUnits(annualCostMinor))
    }

    return {
      ruleId: rule._id,
      title: rule.title,
      amount: fromMinorUnits(rule.amount),
      currency: rule.currency,
      interval: rule.interval,
      monthlyCost: fromMinorUnits(monthlyCostMinor),
      annualCost: fromMinorUnits(annualCostMinor),
      nextChargeDate: formatDateOnly(new Date(rule.nextDueDate)),
      categoryId: rule.categoryId,
      accountId: rule.accountId,
      isCancelled: rule.isCancelled,
    }
  })

  return { subscriptions, totalMonthlyCost, totalAnnualCost }
}
