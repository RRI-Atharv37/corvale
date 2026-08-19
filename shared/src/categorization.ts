import { RecurringInterval } from './types'

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
 * Advances a recurring rule's next due date by one interval.
 *
 * The `timezone` parameter is reserved for Phase 18.2 (timezone-safe
 * recurring due dates) and is intentionally unused today: the server's
 * equivalent is UTC-calendar-only, so this must stay UTC-only too to keep
 * exact parity until that phase lands.
 */
export const advanceNextDueDate = (
    current: Date,
    interval: RecurringInterval,
    customIntervalDays: number | undefined,
    _timezone: string
): Date => {
    const next = new Date(current)

    switch (interval) {
        case 'daily':
            next.setUTCDate(next.getUTCDate() + 1)
            break
        case 'weekly':
            next.setUTCDate(next.getUTCDate() + 7)
            break
        case 'biweekly':
            next.setUTCDate(next.getUTCDate() + 14)
            break
        case 'monthly':
            next.setUTCMonth(next.getUTCMonth() + 1)
            break
        case 'quarterly':
            next.setUTCMonth(next.getUTCMonth() + 3)
            break
        case 'yearly':
            next.setUTCFullYear(next.getUTCFullYear() + 1)
            break
        case 'custom': {
            const days = customIntervalDays
            if (!days || days < 1) {
                throw new Error('customIntervalDays is required for custom intervals')
            }
            next.setUTCDate(next.getUTCDate() + days)
            break
        }
    }

    return next
}
