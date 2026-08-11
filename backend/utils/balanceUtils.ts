import Income from '../models/Income'
import Expense from '../models/Expense'
import Saver from '../models/Saver'
import { toObjectId } from './sharedUtils'

export const roundMoney = (amount: number): number =>
    Math.round((amount + Number.EPSILON) * 100) / 100

export interface UserBalanceSummary {
    totalIncome: number
    totalExpenses: number
    saverBalance: number
    spendableBalance: number
    netWorth: number
}

export const computeUserBalances = async (userId: string): Promise<UserBalanceSummary> => {
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

    const totalIncome = roundMoney(incomeAgg[0]?.total ?? 0)
    const totalExpenses = roundMoney(expenseAgg[0]?.total ?? 0)
    const saverBalance = roundMoney(saver?.saverAmount ?? 0)
    const netWorth = roundMoney(totalIncome - totalExpenses)
    const spendableBalance = roundMoney(Math.max(0, netWorth - saverBalance))

    return {
        totalIncome,
        totalExpenses,
        saverBalance,
        spendableBalance,
        netWorth,
    }
}
