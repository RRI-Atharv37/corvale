export type AccountType = 'checking' | 'cash' | 'credit' | 'savings'

export interface Account {
    _id: string
    userId: string
    workspaceId?: string | null
    name: string
    type: AccountType
    currency: string
    openingBalance: number
    /**
     * The date `openingBalance` is stated "as of". Transactions dated before it
     * are informational only and don't affect `currentBalance`. `null` = no
     * cutoff (legacy accounts: every transaction counts).
     */
    openingBalanceDate?: string | null
    currentBalance: number
    isDefault: boolean
    isArchived: boolean
    interestRate?: number
    minimumPayment?: number
    convertedBalance?: number
    exchangeRateApplied?: number
    hasExchangeRate?: boolean
    createdAt?: string
    updatedAt?: string
}

export interface AccountFormData {
    name: string
    type: AccountType
    currency: string
    openingBalance: string
    openingBalanceDate: string
    interestRate: string
    minimumPayment: string
}

export interface AccountEditFormData {
    name: string
    type: AccountType
    openingBalance: string
    openingBalanceDate: string
    interestRate: string
    minimumPayment: string
}

export interface ReconciliationSession {
    _id: string
    userId: string
    workspaceId?: string | null
    accountId: string
    statementEndDate: string
    statementBalance: number
    clearedBalance: number
    pendingBalance: number
    balanceDifferential: number
    createdAt?: string
    updatedAt?: string
}
