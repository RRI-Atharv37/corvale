export type RecurringInterval =
    | 'daily'
    | 'weekly'
    | 'biweekly'
    | 'monthly'
    | 'quarterly'
    | 'yearly'
    | 'custom'

export type RecurringRuleType = 'income' | 'expense'

export interface RecurringRule {
    _id: string
    userId: string
    workspaceId?: string | null
    title: string
    type: RecurringRuleType
    amount: number
    currency: string
    accountId: string
    categoryId: string
    interval: RecurringInterval
    customIntervalDays?: number
    nextDueDate: string
    description?: string
    paymentMethod?: string
    tags?: string[]
    isActive: boolean
    isArchived: boolean
    isCancelled: boolean
    createdAt?: string
    updatedAt?: string
}

export interface RecurringRuleFormData {
    title: string
    type: RecurringRuleType
    amount: string
    currency: string
    accountId: string
    categoryId: string
    interval: RecurringInterval
    customIntervalDays: string
    nextDueDate: string
    description: string
    paymentMethod: string
    tags: string[]
    isActive: boolean
}
