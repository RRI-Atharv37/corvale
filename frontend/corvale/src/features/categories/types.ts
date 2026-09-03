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

export type CategorizationMatchType =
    | 'description_contains'
    | 'description_equals'
    | 'amount_range'
    | 'account_id'

export interface CategorizationRule {
    _id: string
    userId: string
    name: string
    matchType: CategorizationMatchType
    matchValue?: string
    amountMin?: number
    amountMax?: number
    accountId?: string
    categoryId: string
    tags: string[]
    priority: number
    isActive: boolean
    createdAt?: string
    updatedAt?: string
}

export interface CategorizationRuleFormData {
    name: string
    matchType: CategorizationMatchType
    matchValue: string
    amountMin: string
    amountMax: string
    accountId: string
    categoryId: string
    tags: string[]
    priority: string
    isActive: boolean
}

export interface CategorizationRuleTestResult {
    matched: boolean
    message?: string
    ruleId?: string
    ruleName?: string
    categoryId?: string
    tags?: string[]
}

export interface CategorizationRuleBulkApplyResult {
    message: string
    updated: number
    skipped: number
}
