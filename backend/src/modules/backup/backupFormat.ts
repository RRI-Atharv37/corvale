export const BACKUP_VERSION = 1 as const
export const BACKUP_MAX_ZIP_BYTES = 50 * 1024 * 1024

export interface BackupScope {
    workspaceId: string | null
}

export interface BackupEntityCounts {
    accounts: number
    categories: number
    tags: number
    budgets: number
    savingsGoals: number
    savingsGoalContributions: number
    recurringRules: number
    categorizationRules: number
    transactionTemplates: number
    transactions: number
    receipts: number
}

export interface CorvaleBackupPayload {
    version: typeof BACKUP_VERSION
    exportedAt: string
    scope: BackupScope
    counts: BackupEntityCounts
    accounts: Record<string, unknown>[]
    categories: Record<string, unknown>[]
    tags: Record<string, unknown>[]
    budgets: Record<string, unknown>[]
    savingsGoals: Record<string, unknown>[]
    savingsGoalContributions: Record<string, unknown>[]
    recurringRules: Record<string, unknown>[]
    categorizationRules: Record<string, unknown>[]
    transactionTemplates: Record<string, unknown>[]
    transactions: Record<string, unknown>[]
    receipts: Record<string, unknown>[]
}

export interface BackupRestorePreview {
    valid: boolean
    version: number
    exportedAt: string | null
    sourceScope: BackupScope
    targetScope: BackupScope
    counts: BackupEntityCounts
    warnings: string[]
    errors: string[]
}

export interface BackupRestoreResult {
    created: BackupEntityCounts
    idMapping: Record<string, string>
}

export const emptyCounts = (): BackupEntityCounts => ({
    accounts: 0,
    categories: 0,
    tags: 0,
    budgets: 0,
    savingsGoals: 0,
    savingsGoalContributions: 0,
    recurringRules: 0,
    categorizationRules: 0,
    transactionTemplates: 0,
    transactions: 0,
    receipts: 0,
})

export const buildCounts = (
    payload: Pick<CorvaleBackupPayload, keyof BackupEntityCounts>
): BackupEntityCounts => ({
    accounts: payload.accounts.length,
    categories: payload.categories.length,
    tags: payload.tags.length,
    budgets: payload.budgets.length,
    savingsGoals: payload.savingsGoals.length,
    savingsGoalContributions: payload.savingsGoalContributions.length,
    recurringRules: payload.recurringRules.length,
    categorizationRules: payload.categorizationRules.length,
    transactionTemplates: payload.transactionTemplates.length,
    transactions: payload.transactions.length,
    receipts: payload.receipts.length,
})
