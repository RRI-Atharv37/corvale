import type { LocalDb } from '@platform/db/LocalDb'
import { Repository } from '@platform/db/repositories/Repository'
import { buildBudgetEvent, buildGoalEvent, buildRecurringEvents, type CalendarEvent } from '@shared/calendar'
import { resolveDateRange } from '@shared/timezone'
import type { LocalBudget, LocalRecurringRule, LocalSavingsGoal } from './types'

export type { CalendarEvent, CalendarEventType } from '@shared/calendar'

const recurringRepo = new Repository<LocalRecurringRule>('recurringRules')
const budgetsRepo = new Repository<LocalBudget>('budgets')
const goalsRepo = new Repository<LocalSavingsGoal>('savingsGoals')

/** `LocalSavingsGoal` (domain/types.ts) has no `accountId` field yet - it round-trips fine through
 * the JSON `data` blob (Repository stores the full doc); widened locally rather than touching
 * shared infra, mirroring `pages/Dashboard/hooks/useSavingsGoalsData.ts`. */
interface LocalSavingsGoalRecord extends LocalSavingsGoal {
  accountId?: string | null
}

export interface CalendarLocalOptions {
  start: string
  end: string
  timezone: string
  workspaceId?: string | null
}

const scopedTo = <T extends { workspaceId?: string | null }>(items: T[], workspaceId: string | null): T[] =>
  items.filter((item) => (workspaceId ? item.workspaceId === workspaceId : !item.workspaceId))

/** Local counterpart to `GET /calendar`. */
export const computeLocalCalendar = async (
  db: LocalDb,
  options: CalendarLocalOptions
): Promise<CalendarEvent[]> => {
  let range: { start: Date; end: Date }
  try {
    range = resolveDateRange(options.start, options.end, options.timezone)
  } catch {
    throw new Error('Invalid start/end date range; use YYYY-MM-DD with start on or before end')
  }

  const workspaceId = options.workspaceId ?? null

  const [rules, budgets, goals] = await Promise.all([
    recurringRepo.list(db),
    budgetsRepo.list(db),
    goalsRepo.list(db) as Promise<LocalSavingsGoalRecord[]>,
  ])

  const recurringEvents = scopedTo(rules, workspaceId)
    .filter((rule) => rule.isActive && !rule.isArchived)
    .flatMap((rule) =>
      buildRecurringEvents(
        {
          id: rule._id,
          title: rule.title,
          amount: rule.amount,
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          nextDueDate: new Date(rule.nextDueDate),
          interval: rule.interval,
          customIntervalDays: rule.customIntervalDays,
        },
        range.start,
        range.end
      )
    )

  const budgetEvents = scopedTo(budgets, workspaceId)
    .filter((budget) => !budget.isArchived)
    .filter((budget) => {
      const periodEnd = new Date(budget.periodEnd)
      return periodEnd >= range.start && periodEnd <= range.end
    })
    .map((budget) =>
      buildBudgetEvent({
        id: budget._id,
        name: budget.name,
        amount: budget.amount,
        periodEnd: new Date(budget.periodEnd),
        categoryId: budget.categoryId ?? undefined,
      })
    )

  const goalEvents = scopedTo(goals, workspaceId)
    .filter((goal) => goal.status === 'active' || goal.status === 'paused')
    .filter((goal) => goal.targetDate !== null)
    .filter((goal) => {
      const targetDate = new Date(goal.targetDate as string)
      return targetDate >= range.start && targetDate <= range.end
    })
    .map((goal) =>
      buildGoalEvent({
        id: goal._id,
        name: goal.name,
        targetAmount: goal.targetAmount,
        targetDate: new Date(goal.targetDate as string),
        accountId: goal.accountId ?? undefined,
      })
    )

  const events: CalendarEvent[] = [...recurringEvents, ...budgetEvents, ...goalEvents]
  events.sort((a, b) => a.date.localeCompare(b.date))
  return events
}
