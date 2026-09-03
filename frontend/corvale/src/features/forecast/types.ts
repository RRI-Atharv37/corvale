export type ForecastChangeType = 'recurring' | 'goal' | 'discretionary'

export interface ForecastChange {
    date: string
    type: ForecastChangeType
    amount: number
    label: string
    refId?: string
}

export interface ForecastWarning {
    date: string
    projectedBalance: number
}

export interface ForecastAccount {
    accountId: string
    accountName: string
    currency: string
    startingBalance: number
    projectedEndingBalance: number
    projectedChanges: ForecastChange[]
    lowBalanceWarnings: ForecastWarning[]
}

export interface ForecastResponse {
    days: number
    startDate: string
    endDate: string
    accounts: ForecastAccount[]
}
