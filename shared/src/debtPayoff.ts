import { fromMinorUnits } from './money'

export type PayoffStrategy = 'snowball' | 'avalanche'

export interface DebtInput {
    accountId: string
    balanceMinor: number
    interestRate: number
    minimumPaymentMinor: number
}

export interface DebtPayment {
    accountId: string
    interestPaid: number
    principalPaid: number
    paymentAmount: number
    remainingBalance: number
}

export interface PayoffMonth {
    month: number
    payments: DebtPayment[]
}

export interface PayoffPlan {
    order: string[]
    months: PayoffMonth[]
    totalMonths: number
    totalInterestPaid: number
    totalInterestMinor: number
}

const MAX_MONTHS = 600

/** Snowball: pay off the smallest balance first, regardless of interest rate. */
export const orderDebtsBySnowball = (debts: DebtInput[]): DebtInput[] => {
    return [...debts].sort((a, b) => a.balanceMinor - b.balanceMinor)
}

/** Avalanche: pay off the highest interest rate first, regardless of balance. */
export const orderDebtsByAvalanche = (debts: DebtInput[]): DebtInput[] => {
    return [...debts].sort((a, b) => b.interestRate - a.interestRate)
}

const roundMinor = (value: number): number => Math.round(value)

/**
 * Throws a plain `Error` (not a backend `CustomError`) when a debt cannot be
 * paid off with the given payments — callers on the backend must catch and
 * translate to `CustomError(message, 400)` to preserve existing API behavior.
 */
export const generatePayoffSchedule = (
    debts: DebtInput[],
    extraPaymentMinor: number,
    strategy: PayoffStrategy
): PayoffPlan => {
    const ordered = strategy === 'snowball' ? orderDebtsBySnowball(debts) : orderDebtsByAvalanche(debts)
    const order = ordered.map((debt) => debt.accountId)

    if (ordered.length === 0) {
        return { order: [], months: [], totalMonths: 0, totalInterestPaid: 0, totalInterestMinor: 0 }
    }

    const debtsById = new Map(ordered.map((debt) => [debt.accountId, debt]))
    const remainingById = new Map(ordered.map((debt) => [debt.accountId, debt.balanceMinor]))
    let activeOrder = [...order]

    const months: PayoffMonth[] = []
    let totalInterestMinor = 0
    let extraPool = extraPaymentMinor
    let month = 0

    while (activeOrder.length > 0 && month < MAX_MONTHS) {
        month += 1
        const payments: DebtPayment[] = []
        const target = activeOrder[0]

        for (const accountId of activeOrder) {
            const debt = debtsById.get(accountId) as DebtInput
            const remaining = remainingById.get(accountId) as number
            const interestMinor = roundMinor(remaining * (debt.interestRate / 100 / 12))
            const requestedPayment = debt.minimumPaymentMinor + (accountId === target ? extraPool : 0)
            const paymentMinor = Math.min(requestedPayment, remaining + interestMinor)
            const principalMinor = paymentMinor - interestMinor
            const newRemaining = Math.max(0, remaining + interestMinor - paymentMinor)

            remainingById.set(accountId, newRemaining)
            totalInterestMinor += interestMinor

            payments.push({
                accountId,
                interestPaid: fromMinorUnits(interestMinor),
                principalPaid: fromMinorUnits(principalMinor),
                paymentAmount: fromMinorUnits(paymentMinor),
                remainingBalance: fromMinorUnits(newRemaining),
            })
        }

        months.push({ month, payments })

        const nextActiveOrder: string[] = []
        let rolledMinimumMinor = 0
        for (const accountId of activeOrder) {
            if (remainingById.get(accountId) === 0) {
                rolledMinimumMinor += (debtsById.get(accountId) as DebtInput).minimumPaymentMinor
            } else {
                nextActiveOrder.push(accountId)
            }
        }
        extraPool += rolledMinimumMinor
        activeOrder = nextActiveOrder
    }

    if (activeOrder.length > 0) {
        throw new Error(
            'This debt cannot be paid off with the given payments; minimum payment does not cover monthly interest'
        )
    }

    return {
        order,
        months,
        totalMonths: months.length,
        totalInterestPaid: fromMinorUnits(totalInterestMinor),
        totalInterestMinor,
    }
}
