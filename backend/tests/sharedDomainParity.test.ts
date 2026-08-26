import { describe, it, expect } from 'vitest'
import { Types } from 'mongoose'

import Account, { AccountType } from '../models/Account'
import Budget from '../models/Budget'
import CategorizationRule from '../models/CategorizationRule'
import SavingsGoal from '../models/SavingsGoal'
import SavingsGoalContribution from '../models/SavingsGoalContribution'
import Transaction from '../models/Transaction'
import { seedUserDirectly } from './helpers'

import { computeAccountTotals, computeUserBalances, roundMoney } from '../utils/balanceUtils'
import {
    getBalanceDeltaMajor,
    getTransferInDeltaMajor,
    getTransferOutDeltaMajor,
    validateSplitInputs,
} from '../utils/transactionUtils'
import {
    computeBudgetProgress,
    computeBudgetSpentMinor,
    resolveCustomPeriod,
    resolveMonthlyPeriod,
} from '../utils/budgetUtils'
import {
    computeProjectedCompletionDate,
    computeRequiredMonthlyContribution,
    computeSavingsGoalProgress,
} from '../utils/savingsGoalUtils'
import { endOfDayInTimezone, startOfDayInTimezone } from '../utils/timezoneUtils'
import { convertAmount } from '../utils/exchangeRateUtils'
import { ruleMatchesTransaction } from '../utils/categorizationRuleUtils'
import { advanceNextDueDate } from '../utils/recurringRuleUtils'

import {
    roundMoney as sharedRoundMoney,
    getBalanceDeltaMajor as sharedGetBalanceDeltaMajor,
    getTransferInDeltaMajor as sharedGetTransferInDeltaMajor,
    getTransferOutDeltaMajor as sharedGetTransferOutDeltaMajor,
    validateSplitInputs as sharedValidateSplitInputs,
} from '../../shared/src/money'
import {
    computeAccountTotalsPure,
    computeUserBalancesPure,
    recomputeAccountBalance,
} from '../../shared/src/balances'
import {
    computeBudgetProgress as sharedComputeBudgetProgress,
    computeBudgetSpentMinorPure,
    resolveCustomPeriod as sharedResolveCustomPeriod,
    resolveMonthlyPeriod as sharedResolveMonthlyPeriod,
} from '../../shared/src/budget'
import {
    computeProjectedCompletionDatePure,
    computeSavingsGoalProgressPure,
} from '../../shared/src/savingsGoals'
import {
    convertAmount as sharedConvertAmount,
    endOfDayInTimezone as sharedEndOfDayInTimezone,
    startOfDayInTimezone as sharedStartOfDayInTimezone,
} from '../../shared/src/timezone'
import {
    advanceNextDueDate as sharedAdvanceNextDueDate,
    matchCategorizationRule,
} from '../../shared/src/categorization'

interface AccountLike {
    _id: string
    type: AccountType
    currentBalance: number
    currency: string
    isArchived: boolean
}

interface TransactionLike {
    _id: string
    accountId: string
    categoryId: string
    type: 'income' | 'expense' | 'transfer'
    status: 'posted' | 'draft'
    amount: number
    title: string
    description?: string
    date: Date
    splitTransactionId: string | null
}

interface BudgetLike {
    categoryId: string | null
    periodStart: Date
    periodEnd: Date
    accountIds: string[]
}

interface SplitInput {
    categoryId: string
    amount: unknown
}

interface GoalLike {
    targetAmount: number
    currentAmount: number
    targetDate: Date | null
    status: 'active' | 'paused' | 'completed' | 'archived'
    autoContribution: {
        enabled: boolean
        amount: number
        interval: 'weekly' | 'monthly'
    }
}

interface ContributionLike {
    amount: number
    contributedAt: Date
}

interface RuleLike {
    isActive: boolean
    matchType: 'description_contains' | 'description_equals' | 'amount_range' | 'account_id'
    matchValue?: string
    amountMin?: number
    amountMax?: number
    accountId?: string
}

interface UserBalanceSummary {
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

interface BudgetProgress {
    spent: number
    remaining: number
    percentUsed: number
    isOverBudget: boolean
    budgetAmount: number
}

interface SavingsGoalProgress {
    currentAmount: number
    targetAmount: number
    remaining: number
    percentComplete: number
    isComplete: boolean
    requiredMonthlyContribution: number | null
    projectedCompletionDate: string | null
    monthsRemaining: number | null
}

const ACCOUNT_TYPES: AccountType[] = ['checking', 'cash', 'credit', 'savings']

describe('shared/money parity', () => {
    it('computes identical balance deltas across every transaction type and account type', () => {
        const types: Array<'income' | 'expense' | 'transfer'> = ['income', 'expense', 'transfer']
        const amountsMinor = [0, 1, 999, 123456]

        for (const type of types) {
            for (const accountType of ACCOUNT_TYPES) {
                for (const amountMinor of amountsMinor) {
                    const real = getBalanceDeltaMajor(type, amountMinor, accountType)
                    const shared = sharedGetBalanceDeltaMajor(type, amountMinor, accountType)
                    expect(shared).toBe(real)
                }
            }
        }
    })

    it('computes identical transfer in/out deltas across every account type', () => {
        for (const accountType of ACCOUNT_TYPES) {
            expect(sharedGetTransferInDeltaMajor(15050, accountType)).toBe(
                getTransferInDeltaMajor(15050, accountType)
            )
            expect(sharedGetTransferOutDeltaMajor(15050, accountType)).toBe(
                getTransferOutDeltaMajor(15050, accountType)
            )
        }
    })

    it('rounds money identically, including classic floating-point edge cases', () => {
        const samples = [0.1 + 0.2, 10.005, 10.004, -5.005, 1234.005, 0]
        for (const sample of samples) {
            expect(sharedRoundMoney(sample)).toBe(roundMoney(sample))
        }
        expect(sharedRoundMoney(0.1 + 0.2)).toBe(0.3)
        expect(sharedRoundMoney(10.005)).toBe(10.01)
    })

    it('validates and normalizes split inputs identically', () => {
        const splits: SplitInput[] = [
            { categoryId: 'food-category', amount: 60 },
            { categoryId: 'transport-category', amount: 40 },
        ]

        const real = validateSplitInputs(splits, 10000)
        const shared = sharedValidateSplitInputs(splits, 10000)
        expect(shared).toEqual(real)
        expect(real).toEqual([
            { categoryId: 'food-category', amount: 6000 },
            { categoryId: 'transport-category', amount: 4000 },
        ])
    })

    it('rejects a mismatched split sum identically', () => {
        const badSplits: SplitInput[] = [
            { categoryId: 'food-category', amount: 60 },
            { categoryId: 'transport-category', amount: 30 },
        ]

        expect(() => validateSplitInputs(badSplits, 10000)).toThrow()
        expect(() => sharedValidateSplitInputs(badSplits, 10000)).toThrow()
    })
})

describe('shared/balances parity', () => {
    it('matches account totals and net worth across checking/cash/credit/savings', async () => {
        const { userId } = await seedUserDirectly({ email: 'shared-balances-parity@example.com' })

        await Account.create([
            { userId, name: 'Checking', type: 'checking', currency: 'USD', openingBalance: 1234.56, currentBalance: 1234.56 },
            { userId, name: 'Cash', type: 'cash', currency: 'USD', openingBalance: 300.25, currentBalance: 300.25 },
            { userId, name: 'Credit Card', type: 'credit', currency: 'USD', openingBalance: 800.1, currentBalance: 800.1 },
            { userId, name: 'Savings', type: 'savings', currency: 'USD', openingBalance: 2000.75, currentBalance: 2000.75 },
        ])

        const realTotals = await computeAccountTotals(userId)
        const realBalances = await computeUserBalances(userId)

        const accounts = await Account.find({ userId, isArchived: false })
        const accountsLike: AccountLike[] = accounts.map((account) => ({
            _id: account._id.toString(),
            type: account.type,
            currentBalance: account.currentBalance,
            currency: account.currency,
            isArchived: account.isArchived,
        }))

        const sharedTotals = computeAccountTotalsPure(accountsLike)
        expect(sharedTotals).toEqual(realTotals)
        expect(realTotals.totalAccountBalance).toBe(2735.46)
        expect(realTotals.liquidBalance).toBe(1534.81)
        expect(realTotals.accountCount).toBe(4)

        const sharedBalances = computeUserBalancesPure({
            accounts: accountsLike,
            totalIncomeMajor: realBalances.totalIncome,
            totalExpensesMajor: realBalances.totalExpenses,
            saverBalanceMajor: realBalances.saverBalance,
        })

        const expectedShape: UserBalanceSummary = realBalances
        expect(sharedBalances.netWorth).toBe(expectedShape.netWorth)
        expect(sharedBalances.spendableBalance).toBe(expectedShape.spendableBalance)
        expect(sharedBalances.totalAccountBalance).toBe(expectedShape.totalAccountBalance)
        expect(sharedBalances.liquidBalance).toBe(expectedShape.liquidBalance)
        expect(sharedBalances.accountCount).toBe(expectedShape.accountCount)
        expect(sharedBalances.balanceSource).toBe(expectedShape.balanceSource)
    })

    it('recomputes a checking account balance from posted transactions only, ignoring drafts', () => {
        const account: AccountLike = {
            _id: new Types.ObjectId().toString(),
            type: 'checking',
            currentBalance: 0,
            currency: 'USD',
            isArchived: false,
        }

        const transactions: TransactionLike[] = [
            {
                _id: new Types.ObjectId().toString(),
                accountId: account._id,
                categoryId: new Types.ObjectId().toString(),
                type: 'income',
                status: 'posted',
                amount: 50000,
                title: 'Paycheck',
                date: new Date('2026-01-05T00:00:00.000Z'),
                splitTransactionId: null,
            },
            {
                _id: new Types.ObjectId().toString(),
                accountId: account._id,
                categoryId: new Types.ObjectId().toString(),
                type: 'expense',
                status: 'posted',
                amount: 20000,
                title: 'Groceries',
                date: new Date('2026-01-06T00:00:00.000Z'),
                splitTransactionId: null,
            },
            {
                _id: new Types.ObjectId().toString(),
                accountId: account._id,
                categoryId: new Types.ObjectId().toString(),
                type: 'expense',
                status: 'draft',
                amount: 999900,
                title: 'Undecided big purchase',
                date: new Date('2026-01-07T00:00:00.000Z'),
                splitTransactionId: null,
            },
        ]

        const openingBalanceMajor = 1000
        const postedDelta = transactions
            .filter((tx) => tx.status === 'posted')
            .reduce((sum, tx) => sum + getBalanceDeltaMajor(tx.type, tx.amount, account.type), 0)
        const expectedBalance = sharedRoundMoney(openingBalanceMajor + postedDelta)

        const result = recomputeAccountBalance(
            { ...account, currentBalance: openingBalanceMajor },
            transactions
        )
        expect(result).toBe(expectedBalance)
        expect(result).toBe(1300)
    })

    it('recomputes a credit account balance with the sign flip applied', () => {
        const account: AccountLike = {
            _id: new Types.ObjectId().toString(),
            type: 'credit',
            currentBalance: 0,
            currency: 'USD',
            isArchived: false,
        }

        const transactions: TransactionLike[] = [
            {
                _id: new Types.ObjectId().toString(),
                accountId: account._id,
                categoryId: new Types.ObjectId().toString(),
                type: 'expense',
                status: 'posted',
                amount: 10000,
                title: 'Card purchase',
                date: new Date('2026-02-01T00:00:00.000Z'),
                splitTransactionId: null,
            },
            {
                _id: new Types.ObjectId().toString(),
                accountId: account._id,
                categoryId: new Types.ObjectId().toString(),
                type: 'income',
                status: 'posted',
                amount: 3000,
                title: 'Card payment',
                date: new Date('2026-02-05T00:00:00.000Z'),
                splitTransactionId: null,
            },
        ]

        const result = recomputeAccountBalance(account, transactions)
        expect(result).toBe(70)
    })

    it('counts a split parent once and ignores its split children', () => {
        const account: AccountLike = {
            _id: new Types.ObjectId().toString(),
            type: 'checking',
            currentBalance: 0,
            currency: 'USD',
            isArchived: false,
        }
        const parentId = new Types.ObjectId().toString()

        const transactions: TransactionLike[] = [
            {
                _id: parentId,
                accountId: account._id,
                categoryId: new Types.ObjectId().toString(),
                type: 'expense',
                status: 'posted',
                amount: 15000,
                title: 'Split trip',
                date: new Date('2026-03-01T00:00:00.000Z'),
                splitTransactionId: null,
            },
            {
                _id: new Types.ObjectId().toString(),
                accountId: account._id,
                categoryId: new Types.ObjectId().toString(),
                type: 'expense',
                status: 'posted',
                amount: 9000,
                title: 'Split trip',
                date: new Date('2026-03-01T00:00:00.000Z'),
                splitTransactionId: parentId,
            },
            {
                _id: new Types.ObjectId().toString(),
                accountId: account._id,
                categoryId: new Types.ObjectId().toString(),
                type: 'expense',
                status: 'posted',
                amount: 6000,
                title: 'Split trip',
                date: new Date('2026-03-01T00:00:00.000Z'),
                splitTransactionId: parentId,
            },
        ]

        const result = recomputeAccountBalance({ ...account, currentBalance: 1000 }, transactions)
        expect(result).toBe(850)
    })
})

describe('shared/budget parity', () => {
    it('resolves monthly periods identically in UTC and a non-UTC timezone', () => {
        const realUtc = resolveMonthlyPeriod(2026, 1, 'UTC')
        const sharedUtc = sharedResolveMonthlyPeriod(2026, 1, 'UTC')
        expect(sharedUtc.periodStart.getTime()).toBe(realUtc.periodStart.getTime())
        expect(sharedUtc.periodEnd.getTime()).toBe(realUtc.periodEnd.getTime())

        const realKolkata = resolveMonthlyPeriod(2026, 6, 'Asia/Kolkata')
        const sharedKolkata = sharedResolveMonthlyPeriod(2026, 6, 'Asia/Kolkata')
        expect(sharedKolkata.periodStart.getTime()).toBe(realKolkata.periodStart.getTime())
        expect(sharedKolkata.periodEnd.getTime()).toBe(realKolkata.periodEnd.getTime())
    })

    it('resolves a custom period crossing the US spring-forward DST transition identically', () => {
        const realDst = resolveCustomPeriod('2026-03-01', '2026-03-31', 'America/New_York')
        const sharedDst = sharedResolveCustomPeriod('2026-03-01', '2026-03-31', 'America/New_York')
        expect(sharedDst.periodStart.getTime()).toBe(realDst.periodStart.getTime())
        expect(sharedDst.periodEnd.getTime()).toBe(realDst.periodEnd.getTime())
    })

    it('computes budget spent identically for category, transport, and overall budgets under the split-children rule', async () => {
        const { userId } = await seedUserDirectly({ email: 'shared-budget-parity@example.com' })
        const account = await Account.create({
            userId,
            name: 'Checking',
            type: 'checking',
            currency: 'USD',
            openingBalance: 0,
            currentBalance: 0,
        })
        const foodCategoryId = new Types.ObjectId()
        const transportCategoryId = new Types.ObjectId()

        const parent = await Transaction.create({
            userId,
            accountId: account._id,
            categoryId: foodCategoryId,
            type: 'expense',
            status: 'posted',
            amount: 10000,
            currency: 'USD',
            title: 'Split trip',
            date: new Date('2026-01-05T12:00:00.000Z'),
            splitTransactionId: null,
        })

        // split child matches parent category, parent itself must be excluded once it has children
        await Transaction.create({
            userId,
            accountId: account._id,
            categoryId: foodCategoryId,
            type: 'expense',
            status: 'posted',
            amount: 6000,
            currency: 'USD',
            title: 'Split trip',
            date: new Date('2026-01-05T12:00:00.000Z'),
            splitTransactionId: parent._id,
        })

        await Transaction.create({
            userId,
            accountId: account._id,
            categoryId: transportCategoryId,
            type: 'expense',
            status: 'posted',
            amount: 4000,
            currency: 'USD',
            title: 'Split trip',
            date: new Date('2026-01-05T12:00:00.000Z'),
            splitTransactionId: parent._id,
        })

        await Transaction.create({
            userId,
            accountId: account._id,
            categoryId: foodCategoryId,
            type: 'expense',
            status: 'posted',
            amount: 5000,
            currency: 'USD',
            title: 'Regular food expense',
            date: new Date('2026-01-08T12:00:00.000Z'),
            splitTransactionId: null,
        })

        await Transaction.create({
            userId,
            accountId: account._id,
            categoryId: foodCategoryId,
            type: 'expense',
            status: 'draft',
            amount: 999900,
            currency: 'USD',
            title: 'Draft that must be excluded',
            date: new Date('2026-01-09T12:00:00.000Z'),
            splitTransactionId: null,
        })

        await Transaction.create({
            userId,
            accountId: account._id,
            categoryId: foodCategoryId,
            type: 'transfer',
            status: 'posted',
            amount: 999900,
            currency: 'USD',
            title: 'Transfer that must be excluded',
            date: new Date('2026-01-10T12:00:00.000Z'),
            splitTransactionId: null,
        })

        const { periodStart, periodEnd } = resolveMonthlyPeriod(2026, 1, 'UTC')

        const foodBudget = await Budget.create({
            userId,
            periodType: 'monthly',
            periodStart,
            periodEnd,
            categoryId: foodCategoryId,
            amount: 100000,
            currency: 'USD',
            accountIds: [],
        })
        const transportBudget = await Budget.create({
            userId,
            periodType: 'monthly',
            periodStart,
            periodEnd,
            categoryId: transportCategoryId,
            amount: 100000,
            currency: 'USD',
            accountIds: [],
        })
        const overallBudget = await Budget.create({
            userId,
            periodType: 'monthly',
            periodStart,
            periodEnd,
            categoryId: null,
            amount: 1000000,
            currency: 'USD',
            accountIds: [],
        })

        const allTransactions = await Transaction.find({ userId })
        const transactionsLike: TransactionLike[] = allTransactions.map((tx) => ({
            _id: tx._id.toString(),
            accountId: tx.accountId.toString(),
            categoryId: tx.categoryId.toString(),
            type: tx.type,
            status: tx.status,
            amount: tx.amount,
            title: tx.title,
            date: tx.date,
            splitTransactionId: tx.splitTransactionId ? tx.splitTransactionId.toString() : null,
        }))

        const toBudgetLike = (budget: { categoryId: Types.ObjectId | null }): BudgetLike => ({
            categoryId: budget.categoryId ? budget.categoryId.toString() : null,
            periodStart,
            periodEnd,
            accountIds: [],
        })

        const realFoodSpent = await computeBudgetSpentMinor(foodBudget)
        const realTransportSpent = await computeBudgetSpentMinor(transportBudget)
        const realOverallSpent = await computeBudgetSpentMinor(overallBudget)

        expect(realFoodSpent).toBe(11000)
        expect(realTransportSpent).toBe(4000)
        expect(realOverallSpent).toBe(15000)

        expect(
            computeBudgetSpentMinorPure(toBudgetLike(foodBudget), transactionsLike)
        ).toBe(realFoodSpent)
        expect(
            computeBudgetSpentMinorPure(toBudgetLike(transportBudget), transactionsLike)
        ).toBe(realTransportSpent)
        expect(
            computeBudgetSpentMinorPure(toBudgetLike(overallBudget), transactionsLike)
        ).toBe(realOverallSpent)
    })

    it('computes budget progress identically, including the zero-budget edge case', () => {
        const pairs: Array<[number, number]> = [
            [10000, 7500],
            [10000, 12500],
            [10000, 10000],
            [0, 500],
        ]

        for (const [budgetAmountMinor, spentMinor] of pairs) {
            const real: BudgetProgress = computeBudgetProgress(budgetAmountMinor, spentMinor)
            const shared: BudgetProgress = sharedComputeBudgetProgress(budgetAmountMinor, spentMinor)
            expect(shared).toEqual(real)
        }
    })
})

describe('shared/savingsGoals parity', () => {
    const NOW = new Date('2026-08-12T12:00:00.000Z')

    it('computes required monthly contribution and progress identically for a goal with a target date', async () => {
        const { userId } = await seedUserDirectly({ email: 'shared-goal-target-date@example.com' })
        const targetDate = endOfDayInTimezone('2026-12-31', 'UTC')

        const goal = await SavingsGoal.create({
            userId,
            name: 'Vacation',
            targetAmount: 100000,
            currentAmount: 25000,
            currency: 'USD',
            targetDate,
            status: 'active',
            autoContribution: { enabled: false, amount: 0, interval: 'monthly' },
        })

        const realRequired = computeRequiredMonthlyContribution(
            goal.targetAmount,
            goal.currentAmount,
            goal.targetDate,
            NOW
        )
        expect(realRequired).toBe(187.5)

        const realProgress = await computeSavingsGoalProgress(goal, NOW)

        const goalLike: GoalLike = {
            targetAmount: goal.targetAmount,
            currentAmount: goal.currentAmount,
            targetDate: goal.targetDate ?? null,
            status: goal.status,
            autoContribution: {
                enabled: goal.autoContribution.enabled,
                amount: goal.autoContribution.amount,
                interval: goal.autoContribution.interval,
            },
        }

        const sharedProgress: SavingsGoalProgress = computeSavingsGoalProgressPure(goalLike, [], NOW)

        expect(sharedProgress.currentAmount).toBe(realProgress.currentAmount)
        expect(sharedProgress.targetAmount).toBe(realProgress.targetAmount)
        expect(sharedProgress.remaining).toBe(realProgress.remaining)
        expect(sharedProgress.percentComplete).toBe(realProgress.percentComplete)
        expect(sharedProgress.isComplete).toBe(realProgress.isComplete)
        expect(sharedProgress.requiredMonthlyContribution).toBe(realProgress.requiredMonthlyContribution)
        expect(sharedProgress.monthsRemaining).toBe(realProgress.monthsRemaining)
    })

    it('projects completion date identically from the average of manual contributions when there is no target date', async () => {
        const { userId } = await seedUserDirectly({ email: 'shared-goal-no-target-date@example.com' })

        const goal = await SavingsGoal.create({
            userId,
            name: 'Rainy day fund',
            targetAmount: 50000,
            currentAmount: 10000,
            currency: 'USD',
            targetDate: null,
            status: 'active',
            autoContribution: { enabled: false, amount: 0, interval: 'monthly' },
        })

        const contributions = await SavingsGoalContribution.create([
            { userId, goalId: goal._id, amount: 5000, type: 'manual', contributedAt: new Date('2026-05-01T00:00:00.000Z') },
            { userId, goalId: goal._id, amount: 5000, type: 'manual', contributedAt: new Date('2026-07-01T00:00:00.000Z') },
        ])

        const realProjected = await computeProjectedCompletionDate(goal, NOW)
        expect(realProjected).toBe('2027-12-12')

        const realProgress = await computeSavingsGoalProgress(goal, NOW)
        expect(realProgress.projectedCompletionDate).toBe(realProjected)
        expect(realProgress.requiredMonthlyContribution).toBeNull()
        expect(realProgress.monthsRemaining).toBeNull()

        const goalLike: GoalLike = {
            targetAmount: goal.targetAmount,
            currentAmount: goal.currentAmount,
            targetDate: null,
            status: goal.status,
            autoContribution: { enabled: false, amount: 0, interval: 'monthly' },
        }
        const contributionsLike: ContributionLike[] = contributions.map((c) => ({
            amount: c.amount,
            contributedAt: c.contributedAt,
        }))

        const sharedProjected = computeProjectedCompletionDatePure(goalLike, contributionsLike, NOW)
        expect(sharedProjected).toBe(realProjected)

        const sharedProgress = computeSavingsGoalProgressPure(goalLike, contributionsLike, NOW)
        expect(sharedProgress.projectedCompletionDate).toBe(realProgress.projectedCompletionDate)
        expect(sharedProgress.requiredMonthlyContribution).toBe(realProgress.requiredMonthlyContribution)
        expect(sharedProgress.monthsRemaining).toBe(realProgress.monthsRemaining)
        expect(sharedProgress.percentComplete).toBe(realProgress.percentComplete)
    })

    it('projects completion date identically when auto-contribution is enabled', async () => {
        const goal = await SavingsGoal.create({
            userId: new Types.ObjectId(),
            name: 'Test projection',
            targetAmount: 100000,
            currentAmount: 25000,
            currency: 'USD',
            autoContribution: { enabled: true, amount: 25000, interval: 'monthly' },
        })

        const realProjected = await computeProjectedCompletionDate(goal, NOW)
        expect(realProjected).toBe('2026-11-12')

        const goalLike: GoalLike = {
            targetAmount: goal.targetAmount,
            currentAmount: goal.currentAmount,
            targetDate: null,
            status: goal.status,
            autoContribution: { enabled: true, amount: 25000, interval: 'monthly' },
        }
        const sharedProjected = computeProjectedCompletionDatePure(goalLike, [], NOW)
        expect(sharedProjected).toBe(realProjected)
    })
})

describe('shared/timezone parity', () => {
    it('computes identical day boundaries in UTC and a fixed-offset non-UTC timezone', () => {
        const realStart = startOfDayInTimezone('2026-06-15', 'Asia/Kolkata')
        const sharedStart = sharedStartOfDayInTimezone('2026-06-15', 'Asia/Kolkata')
        expect(sharedStart.getTime()).toBe(realStart.getTime())

        const realEnd = endOfDayInTimezone('2026-06-15', 'Asia/Kolkata')
        const sharedEnd = sharedEndOfDayInTimezone('2026-06-15', 'Asia/Kolkata')
        expect(sharedEnd.getTime()).toBe(realEnd.getTime())
    })

    it('computes identical day boundaries either side of a DST transition', () => {
        const beforeReal = startOfDayInTimezone('2026-03-07', 'America/New_York')
        const beforeShared = sharedStartOfDayInTimezone('2026-03-07', 'America/New_York')
        expect(beforeShared.getTime()).toBe(beforeReal.getTime())

        const afterReal = startOfDayInTimezone('2026-03-09', 'America/New_York')
        const afterShared = sharedStartOfDayInTimezone('2026-03-09', 'America/New_York')
        expect(afterShared.getTime()).toBe(afterReal.getTime())

        const onTransitionReal = endOfDayInTimezone('2026-03-08', 'America/New_York')
        const onTransitionShared = sharedEndOfDayInTimezone('2026-03-08', 'America/New_York')
        expect(onTransitionShared.getTime()).toBe(onTransitionReal.getTime())
    })

    it('converts currency identically for a direct pair, an inverse pair, and the unconfigured 1:1 fallback', () => {
        const rates = { EUR_USD: 1.25, GBP_USD: 1.5 }

        const realDirect = convertAmount(100, 'EUR', 'USD', rates)
        const sharedDirect = sharedConvertAmount(100, 'EUR', 'USD', rates)
        expect(sharedDirect).toBeCloseTo(realDirect.convertedAmount, 10)
        expect(realDirect.convertedAmount).toBe(125)

        const realInverse = convertAmount(100, 'USD', 'EUR', rates)
        const sharedInverse = sharedConvertAmount(100, 'USD', 'EUR', rates)
        expect(sharedInverse).toBeCloseTo(realInverse.convertedAmount, 10)

        const realFallback = convertAmount(50, 'JPY', 'USD', rates)
        const sharedFallback = sharedConvertAmount(50, 'JPY', 'USD', rates)
        expect(sharedFallback).toBe(realFallback.convertedAmount)
        expect(realFallback.rateConfigured).toBe(false)
        expect(sharedFallback).toBe(50)
    })
})

describe('shared/categorization parity', () => {
    it('matches transactions against every rule type identically', async () => {
        const { userId } = await seedUserDirectly({ email: 'shared-categorization-parity@example.com' })
        const matchedAccount = await Account.create({
            userId,
            name: 'Checking',
            type: 'checking',
            currency: 'USD',
            openingBalance: 0,
            currentBalance: 0,
        })
        const otherAccount = await Account.create({
            userId,
            name: 'Other',
            type: 'cash',
            currency: 'USD',
            openingBalance: 0,
            currentBalance: 0,
        })
        const categoryId = new Types.ObjectId()

        const containsRule = await CategorizationRule.create({
            userId,
            name: 'Coffee rule',
            matchType: 'description_contains',
            matchValue: 'coffee',
            categoryId,
            priority: 0,
            isActive: true,
        })
        const equalsRule = await CategorizationRule.create({
            userId,
            name: 'Rent rule',
            matchType: 'description_equals',
            matchValue: 'rent',
            categoryId,
            priority: 0,
            isActive: true,
        })
        const rangeRule = await CategorizationRule.create({
            userId,
            name: 'Range rule',
            matchType: 'amount_range',
            amountMin: 5000,
            amountMax: 20000,
            categoryId,
            priority: 0,
            isActive: true,
        })
        const accountRule = await CategorizationRule.create({
            userId,
            name: 'Account rule',
            matchType: 'account_id',
            accountId: matchedAccount._id,
            categoryId,
            priority: 0,
            isActive: true,
        })
        const inactiveRule = await CategorizationRule.create({
            userId,
            name: 'Inactive rule',
            matchType: 'description_contains',
            matchValue: 'coffee',
            categoryId,
            priority: 0,
            isActive: false,
        })

        const rules = [containsRule, equalsRule, rangeRule, accountRule, inactiveRule]

        const inputs = [
            { title: 'Morning Coffee', description: '', amount: 500, accountId: otherAccount._id.toString(), type: 'expense' as const },
            { title: 'Rent', description: '', amount: 150000, accountId: otherAccount._id.toString(), type: 'expense' as const },
            { title: 'Random purchase', description: '', amount: 10000, accountId: otherAccount._id.toString(), type: 'expense' as const },
            { title: 'Random purchase', description: '', amount: 10000, accountId: matchedAccount._id.toString(), type: 'expense' as const },
            { title: 'Coffee transfer', description: '', amount: 500, accountId: otherAccount._id.toString(), type: 'transfer' as const },
        ]

        for (const rule of rules) {
            const ruleLike: RuleLike = {
                isActive: rule.isActive,
                matchType: rule.matchType,
                matchValue: rule.matchValue,
                amountMin: rule.amountMin,
                amountMax: rule.amountMax,
                accountId: rule.accountId?.toString(),
            }

            for (const input of inputs) {
                const real = ruleMatchesTransaction(rule, input)
                const shared = matchCategorizationRule(ruleLike, input)
                expect(shared).toBe(real)
            }
        }
    })

    it('advances the next due date identically across every recurring interval', () => {
        const current = new Date('2026-01-31T00:00:00.000Z')
        const intervals: Array<{ interval: Parameters<typeof advanceNextDueDate>[1]; customIntervalDays?: number }> = [
            { interval: 'daily' },
            { interval: 'weekly' },
            { interval: 'biweekly' },
            { interval: 'monthly' },
            { interval: 'quarterly' },
            { interval: 'yearly' },
            { interval: 'custom', customIntervalDays: 10 },
        ]

        for (const { interval, customIntervalDays } of intervals) {
            const real = advanceNextDueDate(current, interval, customIntervalDays)
            const shared = sharedAdvanceNextDueDate(current, interval, customIntervalDays, 'UTC')
            expect(shared.getTime()).toBe(real.getTime())
        }
    })

    it('advances the next due date identically across a DST boundary', () => {
        const current = new Date('2026-03-08T00:00:00.000Z')
        const real = advanceNextDueDate(current, 'daily', undefined, 'America/New_York')
        const shared = sharedAdvanceNextDueDate(current, 'daily', undefined, 'America/New_York')
        expect(shared.getTime()).toBe(real.getTime())
    })
})
