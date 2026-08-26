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
 */
export const advanceNextDueDate = (
    current: Date,
    interval: RecurringInterval,
    customIntervalDays: number | undefined,
    timezone: string
): Date => {
    const [year, month, day] = dateStringInTimezone(current, timezone).split('-').map(Number)
    const anchor = new Date(Date.UTC(year, month - 1, day))

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
            anchor.setUTCMonth(anchor.getUTCMonth() + 1)
            break
        case 'quarterly':
            anchor.setUTCMonth(anchor.getUTCMonth() + 3)
            break
        case 'yearly':
            anchor.setUTCFullYear(anchor.getUTCFullYear() + 1)
            break
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
