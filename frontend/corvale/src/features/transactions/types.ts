import type { PaginationMeta, Receipt } from '@lib/types/api'

export type TransactionType = 'income' | 'expense' | 'transfer'
export type TransactionStatus = 'posted' | 'draft'
export type ClearedStatus = 'pending' | 'cleared' | 'reconciled'

export interface Transaction {
    _id: string
    userId: string
    userFullName?: string
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
    recurringPaymentId?: string | null
    clearedStatus: ClearedStatus
    reconciledAt?: string | null
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
    tags: string[]
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

export type TransactionTemplateType = 'income' | 'expense'

export interface TransactionTemplate {
    _id: string
    userId: string
    name: string
    type: TransactionTemplateType
    amount: number
    accountId: string
    categoryId: string
    tags: string[]
    description?: string
    createdAt?: string
    updatedAt?: string
}

export interface TransactionTemplateFormData {
    name: string
    type: TransactionTemplateType
    amount: string
    accountId: string
    categoryId: string
    tags: string[]
    description: string
}
