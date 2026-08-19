import Income from '../models/Income'
import Expense from '../models/Expense'
import Saver from '../models/Saver'
import Account from '../models/Account'
import { toObjectId } from './sharedUtils'
import { buildScopedListFilter } from './workspaceUtils'
import {
    AccountLike,
    AccountTotals,
    computeAccountTotalsPure,
    computeUserBalancesPure,
    CurrencyConversionOptions,
    UserBalanceSummary,
} from '../../shared/src/balances'
import { roundMoney } from '../../shared/src/money'

export { roundMoney }
export type { AccountTotals, UserBalanceSummary, CurrencyConversionOptions }

const toAccountsLike = (
    accounts: Array<{ type: AccountLike['type']; currentBalance: number; currency: string; isArchived: boolean }>
): AccountLike[] =>
    accounts.map((account) => ({
        type: account.type,
        currentBalance: account.currentBalance,
        currency: account.currency,
        isArchived: account.isArchived,
    }))

/**
 * Pre-Phase-1c bridge: when active accounts exist, net worth and spendable
 * derive from account balances. Income/expense totals remain activity metrics only.
 * Full transaction-driven account updates arrive in Phase 1c.
 */
export const computeAccountTotals = async (
    userId: string,
    workspaceId?: string | null,
    conversion?: CurrencyConversionOptions
): Promise<AccountTotals> => {
    const accounts = await Account.find({
        ...buildScopedListFilter(userId, workspaceId ?? null),
        isArchived: false,
    })

    return computeAccountTotalsPure(toAccountsLike(accounts), conversion)
}

export const computeUserBalances = async (
    userId: string,
    workspaceId?: string | null,
    conversion?: CurrencyConversionOptions
): Promise<UserBalanceSummary> => {
    const accounts = await Account.find({
        ...buildScopedListFilter(userId, workspaceId ?? null),
        isArchived: false,
    })
    const accountsLike = toAccountsLike(accounts)

    if (workspaceId) {
        return computeUserBalancesPure({
            accounts: accountsLike,
            totalIncomeMajor: 0,
            totalExpensesMajor: 0,
            saverBalanceMajor: 0,
            workspaceId,
            conversion,
        })
    }

    const objectId = toObjectId(userId)

    const [incomeAgg, expenseAgg, saver] = await Promise.all([
        Income.aggregate([
            { $match: { userId: objectId } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Expense.aggregate([
            { $match: { userId: objectId } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Saver.findOne({ userId: objectId }),
    ])

    return computeUserBalancesPure({
        accounts: accountsLike,
        totalIncomeMajor: incomeAgg[0]?.total ?? 0,
        totalExpensesMajor: expenseAgg[0]?.total ?? 0,
        saverBalanceMajor: saver?.saverAmount ?? 0,
        workspaceId: null,
        conversion,
    })
}
