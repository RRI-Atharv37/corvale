// Cross-cutting API types consumed by every layer (lib/domain/platform/app included).
// Feature-specific shapes live in `src/features/<feature>/types.ts` (RF11).

export interface ApiResponse<T> {
    success: boolean
    data: T
}

export type SupportedCurrency = 'USD' | 'EUR' | 'KRW' | 'INR'

export type DateFormat = 'dd/mm/yy' | 'yy/mm/dd' | 'mm/dd/yy'

export interface LegalAcceptance {
    termsVersion: string
    privacyVersion: string
    acceptedAt: string
    ageAttested: boolean
}

export interface LegalVersions {
    termsVersion: string
    privacyVersion: string
}

export interface NotificationPreferences {
    billRemindersEnabled: boolean
    billReminderDaysBefore: number
}

export type BillingFeature = 'workspaces' | 'prioritySupport' | 'bankSync'

export type EntitlementStatus = 'none' | 'trialing' | 'active' | 'past_due' | 'trial_expired' | 'cancelled'

/**
 * Server-resolved entitlements, riding on every user payload (M2d). Dates are ISO strings. The
 * client gate is UX only - the server enforces every one of these independently. `canRead`,
 * `canExport` and `canSyncPull` are `true` in every state, by contract.
 */
export interface EntitlementSnapshot {
    billingEnabled: boolean
    status: EntitlementStatus
    planCode: 'plus' | 'pro' | null
    canRead: boolean
    canWrite: boolean
    canExport: boolean
    canSyncPull: boolean
    canSyncPush: boolean
    features: Record<BillingFeature, boolean>
    limits: {
        receiptStorageBytes: number | null
        syncDevices: number | null
        workspaceMembers: number | null
    }
    trialEndsAt: string | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    graceEndsAt: string | null
    resolvedAt: string
    /** When write access lapses with no further event; lets an offline client go read-only alone. */
    writableUntil: string | null
}

export interface User {
    _id: string
    fullName: string
    email: string
    timezone?: string
    preferredCurrency?: SupportedCurrency
    dateFormat?: DateFormat
    pageSize?: number
    notificationPreferences?: NotificationPreferences
    exchangeRates?: Record<string, number>
    isEmailVerified?: boolean
    /** Absent for accounts created before versioned consent shipped - they re-accept once. */
    legalAcceptance?: LegalAcceptance
    /** The currently published versions, sent by the server so the client can spot a stale one. */
    legalVersions?: LegalVersions
    /** Absent only on a cache written before entitlements existed - treated as read-only. */
    entitlements?: EntitlementSnapshot
}

export type ExchangeRateMap = Record<string, number>

export interface PaginationMeta {
    totalIncomes?: number
    totalExpenses?: number
    totalTransactions?: number
    pageNumber: number
    totalPages: number
    limit: number
}

export interface Receipt {
    _id: string
    originalFilename: string
    mimeType: string
    size: number
    createdAt?: string
}

// --- Legacy Income/Expense models (frozen; superseded by the unified Transaction) ---

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

// --- Backup (consumed by the local-first engine in domain/ as well as the settings UI) ---

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

export interface BackupRestorePreview {
    valid: boolean
    version: number
    exportedAt: string | null
    sourceScope: { workspaceId: string | null }
    targetScope: { workspaceId: string | null }
    counts: BackupEntityCounts
    warnings: string[]
    errors: string[]
}

export interface BackupRestoreResult {
    created: BackupEntityCounts
    idMapping: Record<string, string>
}
