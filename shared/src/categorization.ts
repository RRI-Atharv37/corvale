import { RecurringInterval } from './types'
import { dateStringInTimezone, startOfDayInTimezone } from './timezone'

export type CategorizationMatchType =
    | 'description_contains'
    | 'description_equals'
    | 'amount_range'
    | 'account_id'

export interface TransactionMatchInput {
    title: string
    description?: string
    amount: number
    accountId: string
    type: string
}

export interface RuleLike {
    isActive: boolean
    matchType: CategorizationMatchType
    matchValue?: string
    amountMin?: number
    amountMax?: number
    accountId?: string
}

const normalizeMatchText = (value: string | undefined): string => (value ?? '').trim().toLowerCase()

const getSearchableText = (input: TransactionMatchInput): string[] => {
    const parts = [input.title, input.description].filter(Boolean) as string[]
    return parts.map((part) => normalizeMatchText(part))
}

export const matchCategorizationRule = (rule: RuleLike, input: TransactionMatchInput): boolean => {
    if (!rule.isActive || input.type === 'transfer') {
        return false
    }

    switch (rule.matchType) {
        case 'description_contains': {
            const needle = normalizeMatchText(rule.matchValue)
            if (!needle) return false
            return getSearchableText(input).some((haystack) => haystack.includes(needle))
        }
        case 'description_equals': {
            const needle = normalizeMatchText(rule.matchValue)
            if (!needle) return false
            return getSearchableText(input).some((haystack) => haystack === needle)
        }
        case 'amount_range': {
            if (rule.amountMin !== undefined && input.amount < rule.amountMin) {
                return false
            }
            if (rule.amountMax !== undefined && input.amount > rule.amountMax) {
                return false
            }
            return true
        }
        case 'account_id': {
            if (!rule.accountId) return false
            return rule.accountId === String(input.accountId)
        }
        default:
            return false
    }
}

const MONTHS_PER_INTERVAL: Partial<Record<RecurringInterval, number>> = {
    monthly: 1,
    quarterly: 3,
    yearly: 12,
}

const addMonthsClamped = (year: number, month: number, months: number, dayOfMonth: number): Date => {
    const totalMonths = year * 12 + (month - 1) + months
    const targetYear = Math.floor(totalMonths / 12)
    const targetMonth = totalMonths % 12
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
    return new Date(Date.UTC(targetYear, targetMonth, Math.min(dayOfMonth, lastDay)))
}

/**
 * Advances a recurring rule's next due date by one interval, staying on
 * local midnight in `timezone` for the new date.
 *
 * `current` is expected to already be a local-midnight instant (as produced
 * by `startOfDayInTimezone`). The interval arithmetic runs on the calendar
 * date in `timezone`, via a UTC-anchored proxy date, then converts the
 * result back to a real instant with `startOfDayInTimezone`. Anchoring the
 * arithmetic in plain UTC (rather than adding milliseconds to the instant
 * directly) is what keeps a DST transition inside the interval from
 * shifting the result by the DST delta.
 *
 * Month-based intervals clamp to the last day of the target month. `anchorDay`
 * is the day of month the rule was set up on (defaults to the day of
 * `current`); passing it lets a rule that was clamped to 28 February return to
 * the 31st in March instead of drifting to the 28th for good.
 */
export const advanceNextDueDate = (
    current: Date,
    interval: RecurringInterval,
    customIntervalDays: number | undefined,
    timezone: string,
    anchorDay?: number
): Date => {
    const [year, month, day] = dateStringInTimezone(current, timezone).split('-').map(Number)
    let anchor = new Date(Date.UTC(year, month - 1, day))

    switch (interval) {
        case 'daily':
            anchor.setUTCDate(anchor.getUTCDate() + 1)
            break
        case 'weekly':
            anchor.setUTCDate(anchor.getUTCDate() + 7)
            break
        case 'biweekly':
            anchor.setUTCDate(anchor.getUTCDate() + 14)
            break
        case 'monthly':
        case 'quarterly':
        case 'yearly': {
            const targetDay =
                anchorDay !== undefined && Number.isInteger(anchorDay) && anchorDay >= 1 && anchorDay <= 31
                    ? anchorDay
                    : day
            anchor = addMonthsClamped(year, month, MONTHS_PER_INTERVAL[interval] as number, targetDay)
            break
        }
        case 'custom': {
            const days = customIntervalDays
            if (!days || days < 1) {
                throw new Error('customIntervalDays is required for custom intervals')
            }
            anchor.setUTCDate(anchor.getUTCDate() + days)
            break
        }
    }

    return startOfDayInTimezone(anchor.toISOString().slice(0, 10), timezone)
}
