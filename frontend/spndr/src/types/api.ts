export interface ApiResponse<T> {
    success: boolean
    data: T
}

export interface User {
    _id: string
    fullName: string
    email: string
}

export interface AuthPayload {
    token: string
    user: User
}

export interface PaginationMeta {
    totalIncomes?: number
    totalExpenses?: number
    pageNumber: number
    totalPages: number
    limit: number
}

export interface Income {
    _id: string
    userId: string
    title: string
    amount: number
    date: string
    source?: string
    description?: string
    category?: string
    icon?: string
}

export interface Expense {
    _id: string
    userId: string
    title: string
    amount: number
    category: string
    date: string
    description?: string
    paymentMethod?: string
    recurring?: string
    tags?: string[]
}

export interface PaginatedIncome {
    data: Income[]
    meta: PaginationMeta
}

export interface PaginatedExpense {
    data: Expense[]
    meta: PaginationMeta
}

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

export interface IncomeFormData {
    title: string
    amount: string
    date: string
    source: string
    description: string
    category: string
}

export interface ExpenseFormData {
    title: string
    amount: string
    category: string
    date: string
    description: string
    paymentMethod: string
    recurring: string
    tags: string
}

export type AccountType = 'checking' | 'cash' | 'credit' | 'savings'

export interface Account {
    _id: string
    userId: string
    workspaceId?: string | null
    name: string
    type: AccountType
    currency: string
    openingBalance: number
    currentBalance: number
    isDefault: boolean
    isArchived: boolean
    createdAt?: string
    updatedAt?: string
}

export interface AccountFormData {
    name: string
    type: AccountType
    currency: string
    openingBalance: string
}

export interface AccountEditFormData {
    name: string
    type: AccountType
}
