export type DebtPayoffStrategy = 'snowball' | 'avalanche'

export interface DebtPayment {
    accountId: string
    interestPaid: number
    principalPaid: number
    paymentAmount: number
    remainingBalance: number
}

export interface DebtPayoffMonth {
    month: number
    payments: DebtPayment[]
}

export interface DebtPayoffPlan {
    strategy: DebtPayoffStrategy
    extraPayment: number
    order: string[]
    totalMonths: number
    totalInterestPaid: number
    months: DebtPayoffMonth[]
}
