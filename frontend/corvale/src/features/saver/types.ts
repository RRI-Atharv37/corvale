export interface SaverDetails {
    totalIncome: number
    totalExpenses: number
    saverBalance: number
    spendableBalance: number
    netWorth: number
    remainingBalance: number
    totalAccountBalance: number
    liquidBalance: number
    accountCount: number
    balanceSource: 'accounts' | 'legacy'
    saverDate?: string
}

export interface SaverResponse {
    message: string
    data: SaverDetails
}

export interface PushoverSnapshot {
    _id: string
    userId: string
    pushoverAmount: number
    pushoverDate: string
}

export interface PushoverRolloverResponse {
    message: string
    data: {
        pushoverAmount: number
        pushoverBaseline: number
        totalIncome: number
        totalExpenses: number
        saverBalance: number
        spendableBalance: number
        netWorth: number
        remainingBalance: number
    }
}
