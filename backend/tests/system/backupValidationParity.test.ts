import { describe, it, expect } from 'vitest'

import {
    BACKUP_ACCOUNT_TYPES,
    BACKUP_AUTO_CONTRIBUTION_INTERVALS,
    BACKUP_BUDGET_PERIOD_TYPES,
    BACKUP_CLEARED_STATUSES,
    BACKUP_CONTRIBUTION_TYPES,
    BACKUP_DEFAULT_CURRENCY,
    BACKUP_GOAL_STATUSES,
    BACKUP_MATCH_TYPES,
    BACKUP_RECURRING_INTERVALS,
    BACKUP_SUPPORTED_CURRENCIES,
    BACKUP_TRANSACTION_STATUSES,
    BACKUP_TRANSACTION_TYPES,
} from '@shared/backupValidation'
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from '@core/money/currencyUtils'
import { ACCOUNT_TYPES } from '@modules/accounts/account.model'
import { BUDGET_PERIOD_TYPES } from '@modules/budgets/budget.model'
import { CATEGORIZATION_MATCH_TYPES } from '@modules/categorization-rules/categorizationRule.model'
import { RECURRING_INTERVALS } from '@modules/recurring/recurringRule.model'
import { AUTO_CONTRIBUTION_INTERVALS, SAVINGS_GOAL_STATUSES } from '@modules/savings-goals/savingsGoal.model'
import { CONTRIBUTION_TYPES } from '@modules/savings-goals/savingsGoalContribution.model'
import {
    CLEARED_STATUSES,
    TRANSACTION_STATUSES,
    TRANSACTION_TYPES,
} from '@modules/transactions/transaction.model'

/**
 * The restore validator lives in `shared/` and cannot import the Mongoose models, so it carries its
 * own copy of each enum. A model that grows a value the validator does not know would make every
 * backup containing it unrestorable; one the validator accepts but the model lacks would be a gap.
 */
describe('shared backup validator enums match the backend models', () => {
    const cases: Array<[string, readonly string[], readonly string[]]> = [
        ['account types', BACKUP_ACCOUNT_TYPES, ACCOUNT_TYPES],
        ['currencies', BACKUP_SUPPORTED_CURRENCIES, SUPPORTED_CURRENCIES],
        ['budget period types', BACKUP_BUDGET_PERIOD_TYPES, BUDGET_PERIOD_TYPES],
        ['rule match types', BACKUP_MATCH_TYPES, CATEGORIZATION_MATCH_TYPES],
        ['recurring intervals', BACKUP_RECURRING_INTERVALS, RECURRING_INTERVALS],
        ['auto-contribution intervals', BACKUP_AUTO_CONTRIBUTION_INTERVALS, AUTO_CONTRIBUTION_INTERVALS],
        ['goal statuses', BACKUP_GOAL_STATUSES, SAVINGS_GOAL_STATUSES],
        ['contribution types', BACKUP_CONTRIBUTION_TYPES, CONTRIBUTION_TYPES],
        ['transaction types', BACKUP_TRANSACTION_TYPES, TRANSACTION_TYPES],
        ['transaction statuses', BACKUP_TRANSACTION_STATUSES, TRANSACTION_STATUSES],
        ['cleared statuses', BACKUP_CLEARED_STATUSES, CLEARED_STATUSES],
    ]

    it.each(cases)('%s', (_label, shared, model) => {
        expect([...shared].sort()).toEqual([...model].sort())
    })

    it('default currency', () => {
        expect(BACKUP_DEFAULT_CURRENCY).toBe(DEFAULT_CURRENCY)
    })
})
