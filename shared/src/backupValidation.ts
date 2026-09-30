import { isTransferRole } from './transferDirection'

export const BACKUP_VALIDATION_MESSAGES = {
    INVALID_FORMAT: 'Backup file is not a valid Corvale backup',
    BROKEN_REFERENCE: 'Backup contains a broken reference and cannot be restored',
    INVALID_RECORD: 'Backup contains a record that fails the same checks the app applies to new data',
    INVALID_AMOUNT: 'Backup contains an amount that is not a whole number of minor units',
    INVALID_TRANSFER: 'Backup contains a transfer that is not a valid pair of legs',
    INVALID_SPLIT: 'Backup contains a split transaction whose lines do not match its parent',
    DUPLICATE_ID: 'Backup contains two records with the same id',
} as const

export class BackupValidationError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'BackupValidationError'
    }
}

export type BackupRecord = Record<string, unknown>

export interface BackupRecordSections {
    categories: BackupRecord[]
    tags: BackupRecord[]
    accounts: BackupRecord[]
    budgets: BackupRecord[]
    savingsGoals: BackupRecord[]
    savingsGoalContributions: BackupRecord[]
    recurringRules: BackupRecord[]
    categorizationRules: BackupRecord[]
    transactionTemplates: BackupRecord[]
    transactions: BackupRecord[]
}

// These mirror the Mongoose enums in the backend models; backend/tests/system/backupValidationParity.test.ts pins them.
export const BACKUP_ACCOUNT_TYPES = ['checking', 'cash', 'credit', 'savings'] as const
export const BACKUP_SUPPORTED_CURRENCIES = ['USD', 'EUR', 'KRW', 'INR'] as const
export const BACKUP_DEFAULT_CURRENCY = 'USD'
export const BACKUP_BUDGET_PERIOD_TYPES = ['monthly', 'custom'] as const
export const BACKUP_MATCH_TYPES = ['description_contains', 'description_equals', 'amount_range', 'account_id'] as const
export const BACKUP_RECURRING_INTERVALS = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom'] as const
export const BACKUP_AUTO_CONTRIBUTION_INTERVALS = ['weekly', 'monthly'] as const
export const BACKUP_GOAL_STATUSES = ['active', 'paused', 'completed', 'archived'] as const
export const BACKUP_CONTRIBUTION_TYPES = ['manual', 'automatic'] as const
export const BACKUP_TRANSACTION_TYPES = ['income', 'expense', 'transfer'] as const
export const BACKUP_TRANSACTION_STATUSES = ['posted', 'draft'] as const
export const BACKUP_CLEARED_STATUSES = ['pending', 'cleared', 'reconciled'] as const

const MATCH_VALUE_MAX_LENGTH = 200
const EXTERNAL_ID_MAX_LENGTH = 255
const DAY_OF_MONTH_MAX = 28

const fail = (message: string = BACKUP_VALIDATION_MESSAGES.INVALID_RECORD): never => {
    throw new BackupValidationError(message)
}

const isPresent = (value: unknown): boolean => value !== undefined && value !== null && value !== ''

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback?: T): T => {
    if (value === undefined || value === null) {
        return fallback ?? fail()
    }
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fail()
}

const requiredString = (value: unknown): string =>
    typeof value === 'string' && value.trim() !== '' ? value : fail()

const optionalString = (value: unknown): string | undefined => {
    if (value === undefined || value === null) {
        return undefined
    }
    return typeof value === 'string' ? value : fail()
}

const booleanValue = (value: unknown, fallback: boolean): boolean => {
    if (value === undefined || value === null) {
        return fallback
    }
    return typeof value === 'boolean' ? value : fail()
}

const stringArray = (value: unknown): string[] => {
    if (value === undefined || value === null) {
        return []
    }
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        return fail()
    }
    return value as string[]
}

const normalizedTags = (value: unknown): string[] => [
    ...new Set(stringArray(value).map((tag) => tag.trim()).filter(Boolean)),
]

const minorAmount = (value: unknown, min: 0 | 1): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
        return fail(BACKUP_VALIDATION_MESSAGES.INVALID_AMOUNT)
    }
    return value
}

const optionalMinorAmount = (value: unknown, min: 0 | 1): number | undefined =>
    value === undefined || value === null ? undefined : minorAmount(value, min)

const dateValue = (value: unknown): Date => {
    if (value instanceof Date && !isNaN(value.getTime())) {
        return value
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value)
        if (!isNaN(parsed.getTime())) {
            return parsed
        }
    }
    return fail(BACKUP_VALIDATION_MESSAGES.INVALID_FORMAT)
}

const optionalDate = (value: unknown): Date | null => (isPresent(value) ? dateValue(value) : null)

const currencyValue = (value: unknown): string => {
    if (value === undefined || value === null) {
        return BACKUP_DEFAULT_CURRENCY
    }
    const currency = typeof value === 'string' ? value.trim().toUpperCase() : ''
    return (BACKUP_SUPPORTED_CURRENCIES as readonly string[]).includes(currency) ? currency : fail()
}

const nonNegativeNumber = (value: unknown): number | undefined => {
    if (value === undefined || value === null) {
        return undefined
    }
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fail()
}

const TAG_NAME_MAX_LENGTH = 50

const parseCategory = (record: BackupRecord) => ({
    name: requiredString(record.name),
    color: optionalString(record.color),
    icon: optionalString(record.icon),
    sortOrder: nonNegativeNumber(record.sortOrder),
    isArchived: booleanValue(record.isArchived, false),
})

const parseTag = (record: BackupRecord) => {
    const name = requiredString(record.name).trim()
    if (name.length > TAG_NAME_MAX_LENGTH) {
        fail()
    }
    return { name, color: optionalString(record.color) }
}

const parseAccount = (record: BackupRecord) => {
    const type = oneOf(record.type, BACKUP_ACCOUNT_TYPES)
    const balanceUnit: 'major' | 'minor' = record.balanceUnit === 'minor' ? 'minor' : 'major'

    const openingBalance = record.openingBalance ?? 0
    if (
        typeof openingBalance !== 'number' ||
        !Number.isFinite(openingBalance) ||
        (balanceUnit === 'minor' && !Number.isSafeInteger(openingBalance))
    ) {
        fail(BACKUP_VALIDATION_MESSAGES.INVALID_AMOUNT)
    }

    const interestRate = nonNegativeNumber(record.interestRate)
    const minimumPayment = nonNegativeNumber(record.minimumPayment)
    if (type !== 'credit' && (interestRate !== undefined || minimumPayment !== undefined)) {
        fail()
    }

    return {
        name: requiredString(record.name),
        type,
        currency: currencyValue(record.currency),
        balanceUnit,
        openingBalance: openingBalance as number,
        openingBalanceDate: optionalDate(record.openingBalanceDate),
        interestRate,
        minimumPayment,
        isArchived: booleanValue(record.isArchived, false),
        wantsDefault: booleanValue(record.isDefault, false),
    }
}

const parseBudget = (record: BackupRecord) => {
    const periodStart = dateValue(record.periodStart)
    const periodEnd = dateValue(record.periodEnd)
    if (periodStart.getTime() > periodEnd.getTime()) {
        fail()
    }
    return {
        name: optionalString(record.name),
        periodType: oneOf(record.periodType, BACKUP_BUDGET_PERIOD_TYPES),
        periodStart,
        periodEnd,
        amount: minorAmount(record.amount, 1),
        currency: currencyValue(record.currency),
        rollover: booleanValue(record.rollover, false),
        isArchived: booleanValue(record.isArchived, false),
    }
}

const parseAutoContribution = (value: unknown): Record<string, unknown> => {
    if (value === undefined || value === null) {
        return {}
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        return fail()
    }

    const source = value as BackupRecord
    const result: Record<string, unknown> = {}
    if (isPresent(source.enabled)) {
        result.enabled = booleanValue(source.enabled, false)
    }
    if (isPresent(source.amount)) {
        result.amount = minorAmount(source.amount, 0)
    }
    if (isPresent(source.interval)) {
        result.interval = oneOf(source.interval, BACKUP_AUTO_CONTRIBUTION_INTERVALS)
    }
    if (isPresent(source.dayOfMonth)) {
        const day = source.dayOfMonth
        if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > DAY_OF_MONTH_MAX) {
            fail()
        }
        result.dayOfMonth = day
    }
    if (isPresent(source.lastContributedAt)) {
        result.lastContributedAt = dateValue(source.lastContributedAt)
    }
    return result
}

const parseGoal = (record: BackupRecord) => ({
    name: requiredString(record.name),
    targetAmount: minorAmount(record.targetAmount, 1),
    currency: currencyValue(record.currency),
    status: oneOf(record.status, BACKUP_GOAL_STATUSES, 'active'),
    targetDate: optionalDate(record.targetDate),
    completedAt: optionalDate(record.completedAt),
    autoContribution: parseAutoContribution(record.autoContribution),
    declaredAmount: typeof record.currentAmount === 'number' ? record.currentAmount : 0,
})

const parseContribution = (record: BackupRecord) => ({
    amount: minorAmount(record.amount, 1),
    type: oneOf(record.type, BACKUP_CONTRIBUTION_TYPES),
    note: optionalString(record.note),
    contributedAt: dateValue(record.contributedAt),
})

// A row with no currency (the local engine omits it) takes its account's, as the REST API does.
const requireAccountCurrency = (record: BackupRecord, accountCurrency: string): void => {
    if (record.currency === undefined || record.currency === null) {
        return
    }
    if (typeof record.currency !== 'string' || record.currency.trim().toUpperCase() !== accountCurrency) {
        fail()
    }
}

const optionalAnchorDay = (value: unknown): number | undefined => {
    if (value === undefined || value === null) {
        return undefined
    }
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31 ? value : fail()
}

const parseRecurringRule = (record: BackupRecord, accountCurrency: string) => {
    const interval = oneOf(record.interval, BACKUP_RECURRING_INTERVALS)

    let customIntervalDays: number | undefined
    if (interval === 'custom') {
        const days = record.customIntervalDays
        if (typeof days !== 'number' || !Number.isInteger(days) || days < 1) {
            fail()
        }
        customIntervalDays = days as number
    }
    requireAccountCurrency(record, accountCurrency)

    return {
        title: requiredString(record.title),
        type: oneOf(record.type, ['income', 'expense'] as const),
        amount: minorAmount(record.amount, 1),
        currency: accountCurrency,
        interval,
        customIntervalDays,
        nextDueDate: dateValue(record.nextDueDate),
        anchorDay: optionalAnchorDay(record.anchorDay),
        description: optionalString(record.description),
        paymentMethod: optionalString(record.paymentMethod),
        tags: stringArray(record.tags),
        isActive: booleanValue(record.isActive, true),
        isArchived: booleanValue(record.isArchived, false),
        isCancelled: booleanValue(record.isCancelled, false),
    }
}

const parseCategorizationRule = (record: BackupRecord) => {
    const matchType = oneOf(record.matchType, BACKUP_MATCH_TYPES)
    const matchValue = optionalString(record.matchValue)?.trim()
    const amountMin = optionalMinorAmount(record.amountMin, 0)
    const amountMax = optionalMinorAmount(record.amountMax, 0)

    switch (matchType) {
        case 'description_contains':
        case 'description_equals':
            if (!matchValue || matchValue.length > MATCH_VALUE_MAX_LENGTH) {
                fail()
            }
            break
        case 'amount_range':
            if (
                (amountMin === undefined && amountMax === undefined) ||
                (amountMin !== undefined && amountMax !== undefined && amountMin > amountMax)
            ) {
                fail()
            }
            break
        case 'account_id':
            if (!isPresent(record.accountId)) {
                fail()
            }
            break
    }

    const priority = record.priority ?? 0
    if (typeof priority !== 'number' || !Number.isFinite(priority)) {
        fail()
    }

    return {
        name: requiredString(record.name),
        matchType,
        matchValue,
        amountMin,
        amountMax,
        tags: normalizedTags(record.tags),
        priority: Math.trunc(priority as number),
        isActive: booleanValue(record.isActive, true),
    }
}

const parseTemplate = (record: BackupRecord) => ({
    name: requiredString(record.name),
    type: oneOf(record.type, ['income', 'expense'] as const),
    amount: minorAmount(record.amount, 1),
    tags: normalizedTags(record.tags),
    description: optionalString(record.description),
})

const parseTransaction = (record: BackupRecord, accountCurrency: string) => {
    requireAccountCurrency(record, accountCurrency)

    const clearedStatus = oneOf(record.clearedStatus, BACKUP_CLEARED_STATUSES, 'pending')

    const externalId = optionalString(record.externalId)?.trim()
    if (externalId !== undefined && (externalId === '' || externalId.length > EXTERNAL_ID_MAX_LENGTH)) {
        fail()
    }

    return {
        type: oneOf(record.type, BACKUP_TRANSACTION_TYPES),
        status: oneOf(record.status, BACKUP_TRANSACTION_STATUSES, 'posted'),
        amount: minorAmount(record.amount, 0),
        currency: accountCurrency,
        title: requiredString(record.title),
        description: optionalString(record.description),
        date: dateValue(record.date),
        source: optionalString(record.source),
        paymentMethod: optionalString(record.paymentMethod),
        tags: stringArray(record.tags),
        clearedStatus,
        reconciledAt: clearedStatus === 'reconciled' ? optionalDate(record.reconciledAt) : null,
        externalId,
    }
}

/**
 * Checks the links between transactions that the REST API can only create as a unit: a transfer is
 * two legs that name each other, and a split is a parent with at least two lines summing to it.
 * Returns the source ids of the split parents, from which `hasSplitChildren` is derived.
 */
const validateTransactionLinks = (
    transactions: BackupRecord[],
    currencyOfAccount: (accountId: unknown) => string
): Set<string> => {
    const byId = new Map(transactions.map((record) => [String(record.id), record]))
    const linesByParent = new Map<string, BackupRecord[]>()

    for (const record of transactions) {
        const id = String(record.id)
        const pairId = isPresent(record.transferPairId) ? String(record.transferPairId) : null
        if (isPresent(record.transferRole) && !isTransferRole(record.transferRole)) {
            fail(BACKUP_VALIDATION_MESSAGES.INVALID_TRANSFER)
        }

        if (record.type === 'transfer') {
            if (pairId === null) {
                fail(BACKUP_VALIDATION_MESSAGES.INVALID_TRANSFER)
            }
            const pair = byId.get(pairId as string)
            if (!pair) {
                fail(BACKUP_VALIDATION_MESSAGES.BROKEN_REFERENCE)
            }
            const other = pair as BackupRecord
            if (
                pairId === id ||
                other.type !== 'transfer' ||
                String(other.transferPairId ?? '') !== id ||
                String(other.accountId) === String(record.accountId) ||
                other.amount !== record.amount ||
                currencyOfAccount(other.accountId) !== currencyOfAccount(record.accountId) ||
                isPresent(record.splitTransactionId) ||
                isPresent(other.splitTransactionId) ||
                (isTransferRole(record.transferRole) && record.transferRole === other.transferRole)
            ) {
                fail(BACKUP_VALIDATION_MESSAGES.INVALID_TRANSFER)
            }
        } else if (pairId !== null || isPresent(record.transferRole)) {
            fail(BACKUP_VALIDATION_MESSAGES.INVALID_TRANSFER)
        }

        if (isPresent(record.splitTransactionId)) {
            const parentId = String(record.splitTransactionId)
            const parent = byId.get(parentId)
            if (!parent) {
                fail(BACKUP_VALIDATION_MESSAGES.BROKEN_REFERENCE)
            }
            const owner = parent as BackupRecord
            if (
                parentId === id ||
                isPresent(owner.splitTransactionId) ||
                owner.type !== 'expense' ||
                record.type !== 'expense' ||
                String(owner.accountId) !== String(record.accountId)
            ) {
                fail(BACKUP_VALIDATION_MESSAGES.INVALID_SPLIT)
            }
            linesByParent.set(parentId, [...(linesByParent.get(parentId) ?? []), record])
        }
    }

    for (const [parentId, lines] of linesByParent) {
        const total = lines.reduce((sum, line) => sum + (line.amount as number), 0)
        if (lines.length < 2 || total !== byId.get(parentId)?.amount) {
            fail(BACKUP_VALIDATION_MESSAGES.INVALID_SPLIT)
        }
    }

    return new Set(linesByParent.keys())
}

const assertUniqueIds = (sections: BackupRecord[][]): void => {
    for (const records of sections) {
        const seen = new Set<string>()
        for (const record of records) {
            if (typeof record !== 'object' || record === null || Array.isArray(record) || !isPresent(record.id)) {
                fail(BACKUP_VALIDATION_MESSAGES.INVALID_FORMAT)
            }
            const id = String(record.id)
            if (seen.has(id)) {
                fail(BACKUP_VALIDATION_MESSAGES.DUPLICATE_ID)
            }
            seen.add(id)
        }
    }
}

export type BackupGoalFields = ReturnType<typeof parseGoal>

export interface ValidatedBackup {
    categories: ReturnType<typeof parseCategory>[]
    tags: ReturnType<typeof parseTag>[]
    accounts: ReturnType<typeof parseAccount>[]
    budgets: ReturnType<typeof parseBudget>[]
    goals: BackupGoalFields[]
    contributions: ReturnType<typeof parseContribution>[]
    recurringRules: ReturnType<typeof parseRecurringRule>[]
    categorizationRules: ReturnType<typeof parseCategorizationRule>[]
    templates: ReturnType<typeof parseTemplate>[]
    transactions: ReturnType<typeof parseTransaction>[]
    splitParentIds: Set<string>
    contributedByGoal: Map<string, number>
}

/**
 * Every field a restore writes is parsed here, once, for both the server and the desktop restore,
 * so a crafted file cannot install a value the REST API would refuse or derive. Records come back
 * in file order; nothing is written and no reference is resolved here beyond what validation needs.
 */
export const validateBackupRecords = (backup: BackupRecordSections): ValidatedBackup => {
    assertUniqueIds([
        backup.categories,
        backup.tags,
        backup.accounts,
        backup.budgets,
        backup.savingsGoals,
        backup.savingsGoalContributions,
        backup.recurringRules,
        backup.categorizationRules,
        backup.transactionTemplates,
        backup.transactions,
    ])

    const accounts = backup.accounts.map(parseAccount)
    const currencyBySourceId = new Map(backup.accounts.map((record, index) => [String(record.id), accounts[index].currency]))
    const currencyOfAccount = (sourceAccountId: unknown): string =>
        currencyBySourceId.get(String(sourceAccountId)) ?? fail(BACKUP_VALIDATION_MESSAGES.BROKEN_REFERENCE)

    const transactions = backup.transactions.map((record) => parseTransaction(record, currencyOfAccount(record.accountId)))
    const splitParentIds = validateTransactionLinks(backup.transactions, currencyOfAccount)

    const contributions = backup.savingsGoalContributions.map(parseContribution)
    const contributedByGoal = new Map<string, number>()
    backup.savingsGoalContributions.forEach((record, index) => {
        const goalId = String(record.goalId)
        contributedByGoal.set(goalId, (contributedByGoal.get(goalId) ?? 0) + contributions[index].amount)
    })

    return {
        categories: backup.categories.map(parseCategory),
        tags: backup.tags.map(parseTag),
        accounts,
        budgets: backup.budgets.map(parseBudget),
        goals: backup.savingsGoals.map(parseGoal),
        contributions,
        recurringRules: backup.recurringRules.map((record) => parseRecurringRule(record, currencyOfAccount(record.accountId))),
        categorizationRules: backup.categorizationRules.map(parseCategorizationRule),
        templates: backup.transactionTemplates.map(parseTemplate),
        transactions,
        splitParentIds,
        contributedByGoal,
    }
}

/**
 * The saved amount of a goal is the sum of its contributions, and its status follows from that, the
 * way `recordContribution` and the goal editor keep them. The file's own figures are not trusted.
 */
export const reconcileGoal = (
    fields: { status: BackupGoalFields['status']; targetAmount: number; completedAt: Date | null },
    currentAmount: number
): { status: BackupGoalFields['status']; completedAt: Date | null } => {
    if (fields.status === 'completed' && currentAmount < fields.targetAmount) {
        return { status: 'active', completedAt: null }
    }
    if (fields.status === 'active' && currentAmount >= fields.targetAmount) {
        return { status: 'completed', completedAt: fields.completedAt ?? new Date() }
    }
    return { status: fields.status, completedAt: fields.completedAt }
}
