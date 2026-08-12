export interface ApiResponse<T> {
    success: boolean
    data: T
}

export type SupportedCurrency = 'USD' | 'EUR' | 'KRW' | 'INR'

export interface User {
    _id: string
    fullName: string
    email: string
    timezone?: string
    preferredCurrency?: SupportedCurrency
}

export interface AuthPayload {
    token: string
    user: User
}

export interface PaginationMeta {
    totalIncomes?: number
    totalExpenses?: number
    totalTransactions?: number
    pageNumber: number
    totalPages: number
    limit: number
}

export type TransactionType = 'income' | 'expense' | 'transfer'
export type TransactionStatus = 'posted' | 'draft'

export interface Receipt {
    _id: string
    originalFilename: string
    mimeType: string
    size: number
    createdAt?: string
}

export interface Transaction {
    _id: string
    userId: string
    workspaceId?: string | null
    accountId: string
    categoryId: string
    type: TransactionType
    status: TransactionStatus
    amount: number
    currency: string
    title: string
    description?: string
    date: string
    source?: string
    paymentMethod?: string
    tags?: string[]
    transferPairId?: string | null
    splitTransactionId?: string | null
    splits?: SplitLine[]
    transferPair?: Transaction
    receipts?: Receipt[]
    createdAt?: string
    updatedAt?: string
}

export interface SplitLine {
    _id: string
    categoryId: string
    amount: number
    isSplitChild?: true
}

export interface SplitLineFormData {
    categoryId: string
    amount: string
}

export interface TransactionFormData {
    type: 'income' | 'expense'
    title: string
    amount: string
    date: string
    accountId: string
    categoryId: string
    description: string
    source: string
    paymentMethod: string
    tags: string
    splitEnabled: boolean
    splits: SplitLineFormData[]
}

export interface TransferFormData {
    title: string
    amount: string
    date: string
    fromAccountId: string
    toAccountId: string
    description: string
}

export interface TransferCreateResponse {
    outbound: Transaction
    inbound: Transaction
}

export interface BulkDeleteResponse {
    message: string
    deletedCount: number
}

export interface BulkCategoryResponse {
    message: string
    updatedCount: number
}
export interface PaginatedTransactions {
    data: Transaction[]
    meta: PaginationMeta
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

export interface Category {
    _id: string
    userId: string | null
    masterCategoryId: string | null
    name: string
    icon?: string
    color?: string
    isDefault: boolean
    isArchived: boolean
    sortOrder: number
    createdAt?: string
    updatedAt?: string
}

export interface CategoriesResponse {
    masters: Category[]
    userCategories: Category[]
}

export interface CategoryFormData {
    masterCategoryId: string
    name: string
    icon: string
    color: string
}

export interface CategoryEditFormData {
    name: string
    icon: string
    color: string
}

export type BudgetPeriodType = 'monthly' | 'custom'

export interface BudgetProgress {
    spent: number
    remaining: number
    percentUsed: number
    isOverBudget: boolean
    budgetAmount: number
}

export interface Budget {
    _id: string
    userId: string
    workspaceId?: string | null
    name?: string
    periodType: BudgetPeriodType
    periodStart: string
    periodEnd: string
    categoryId?: string | null
    amount: number
    currency: string
    rollover: boolean
    accountIds: string[]
    isArchived: boolean
    progress?: BudgetProgress
    createdAt?: string
    updatedAt?: string
}

export type BudgetScopeType = 'overall' | 'category'

export interface BudgetFormData {
    name: string
    periodType: BudgetPeriodType
    year: string
    month: string
    periodStart: string
    periodEnd: string
    scopeType: BudgetScopeType
    categoryId: string
    amount: string
    currency: string
    rollover: boolean
    accountIds: string[]
    useAllAccounts: boolean
}
