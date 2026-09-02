import { Types } from 'mongoose'

import { Account } from '@modules/accounts'
import { Budget } from '@modules/budgets'
import { RecurringRule } from '@modules/recurring'
import { SavingsGoal } from '@modules/savings-goals'
import { Transaction } from '@modules/transactions'
import type { SupportedCurrency } from '@core/money/currencyUtils'

/** Updates stored currency on all user-owned financial records (no conversion). */
export const syncUserCurrencyData = async (
    userId: Types.ObjectId,
    currency: SupportedCurrency
): Promise<void> => {
    const filter = { userId }
    const update = { $set: { currency } }

    await Promise.all([
        Account.updateMany(filter, update),
        Transaction.updateMany(filter, update),
        Budget.updateMany(filter, update),
        SavingsGoal.updateMany(filter, update),
        RecurringRule.updateMany(filter, update),
    ])
}
