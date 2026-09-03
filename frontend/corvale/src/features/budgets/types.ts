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
