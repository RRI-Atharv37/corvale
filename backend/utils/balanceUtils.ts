import Income from '../models/Income'
import Expense from '../models/Expense'
import Saver from '../models/Saver'
import Account, { AccountType } from '../models/Account'
import { toObjectId } from './sharedUtils'

export const roundMoney = (amount: number): number =>
    Math.round((amount + Number.EPSILON) * 100) / 100

const ASSET_ACCOUNT_TYPES: AccountType[] = ['checking', 'cash', 'savings']
const LIQUID_ACCOUNT_TYPES: AccountType[] = ['checking', 'cash']

export interface AccountTotals {
    totalAccountBalance: number
    liquidBalance: number
    accountCount: number
}

export interface UserBalanceSummary {
    totalIncome: number
    totalExpenses: number
    saverBalance: number
    spendableBalance: number
    netWorth: number
    totalAccountBalance: number
    liquidBalance: number
    accountCount: number
    balanceSource: 'accounts' | 'legacy'
}

/**
 * Pre-Phase-1c bridge: when active accounts exist, net worth and spendable
 * derive from account balances. Income/expense totals remain activity metrics only.
 * Full transaction-driven account updates arrive in Phase 1c.
 */
export const computeAccountTotals = async (userId: string): Promise<AccountTotals> => {
    const accounts = await Account.find({ userId, isArchived: false })

    let assetTotal = 0
    let creditTotal = 0
    let liquidBalance = 0

    for (const account of accounts) {
        const balance = roundMoney(account.currentBalance)

        if (account.type === 'credit') {
            creditTotal = roundMoney(creditTotal + balance)
        } else if (ASSET_ACCOUNT_TYPES.includes(account.type)) {
            assetTotal = roundMoney(assetTotal + balance)
        }

        if (LIQUID_ACCOUNT_TYPES.includes(account.type)) {
            liquidBalance = roundMoney(liquidBalance + balance)
        }
    }

    return {
        totalAccountBalance: roundMoney(assetTotal - creditTotal),
        liquidBalance,
        accountCount: accounts.length,
    }
}

export const computeUserBalances = async (userId: string): Promise<UserBalanceSummary> => {
    const objectId = toObjectId(userId)

    const [incomeAgg, expenseAgg, saver, accountTotals] = await Promise.all([
        Income.aggregate([
            { $match: { userId: objectId } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Expense.aggregate([
            { $match: { userId: objectId } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        Saver.findOne({ userId: objectId }),
        computeAccountTotals(userId),
    ])

    const totalIncome = roundMoney(incomeAgg[0]?.total ?? 0)
    const totalExpenses = roundMoney(expenseAgg[0]?.total ?? 0)
    const saverBalance = roundMoney(saver?.saverAmount ?? 0)

    if (accountTotals.accountCount > 0) {
        const netWorth = accountTotals.totalAccountBalance
        const spendableBalance = roundMoney(Math.max(0, accountTotals.liquidBalance - saverBalance))

        return {
            totalIncome,
            totalExpenses,
            saverBalance,
            spendableBalance,
            netWorth,
            totalAccountBalance: accountTotals.totalAccountBalance,
            liquidBalance: accountTotals.liquidBalance,
            accountCount: accountTotals.accountCount,
            balanceSource: 'accounts',
        }
    }

    const netWorth = roundMoney(totalIncome - totalExpenses)
    const spendableBalance = roundMoney(Math.max(0, netWorth - saverBalance))

    return {
        totalIncome,
        totalExpenses,
        saverBalance,
        spendableBalance,
        netWorth,
        totalAccountBalance: 0,
        liquidBalance: 0,
        accountCount: 0,
        balanceSource: 'legacy',
    }
}
