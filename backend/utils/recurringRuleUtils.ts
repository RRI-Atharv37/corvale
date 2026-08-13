import { Types } from 'mongoose'

import RecurringRule, {
    IRecurringRule,
    RECURRING_INTERVALS,
    RecurringInterval,
} from '../models/RecurringRule'
import Transaction, { ITransaction, TransactionType } from '../models/Transaction'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'
import { fromMinorUnits, parseAmountToMinorUnits } from './moneyUtils'
import { startOfDayInTimezone } from './timezoneUtils'
import {
    applyTransactionToAccount,
    serializeTransaction,
    SerializedTransaction,
    validateAccountForTransaction,
    validateCategoryForTransaction,
} from './transactionUtils'
import { assertAccountMatchesWorkspace, buildScopedListFilter } from './workspaceUtils'

export interface SerializedRecurringRule {
    _id: Types.ObjectId
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
    title: string
    type: TransactionType
    amount: number
    currency: string
    accountId: Types.ObjectId
    categoryId: Types.ObjectId
    interval: RecurringInterval
    customIntervalDays?: number
    nextDueDate: Date
    description?: string
    paymentMethod?: string
    tags?: string[]
    isActive: boolean
    isArchived: boolean
    createdAt: Date
    updatedAt: Date
}

const MAX_CATCHUP_DRAFTS = 52

export const parseRecurringAmount = (value: unknown): number => {
    try {
        const minor = parseAmountToMinorUnits(value)
        if (minor <= 0) {
            throw new Error('Amount must be greater than zero')
        }
        return minor
    } catch {
        throw new CustomError('Invalid recurring amount; must be a positive number', 400)
    }
}

export const parseInterval = (value: unknown): RecurringInterval => {
    if (typeof value !== 'string' || !RECURRING_INTERVALS.includes(value as RecurringInterval)) {
        throw new CustomError(
            `Invalid interval. Must be one of: ${RECURRING_INTERVALS.join(', ')}`,
            400
        )
    }
    return value as RecurringInterval
}

export const parseTransactionType = (value: unknown): 'income' | 'expense' => {
    if (value !== 'income' && value !== 'expense') {
        throw new CustomError('Recurring rule type must be income or expense', 400)
    }
    return value
}

export const parseNextDueDate = (value: unknown, timezone: string): Date => {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        throw new CustomError('Invalid nextDueDate; use YYYY-MM-DD format', 400)
    }

    const dateOnly = value.slice(0, 10)
    try {
        return startOfDayInTimezone(dateOnly, timezone)
    } catch {
        throw new CustomError('Invalid nextDueDate; use YYYY-MM-DD format', 400)
    }
}

export const parseCustomIntervalDays = (
    interval: RecurringInterval,
    value: unknown
): number | undefined => {
    if (interval !== 'custom') {
        return undefined
    }

    const days = Number(value)
    if (!Number.isInteger(days) || days < 1) {
        throw new CustomError('customIntervalDays must be a positive integer for custom intervals', 400)
    }
    return days
}

export const advanceNextDueDate = (
    current: Date,
    interval: RecurringInterval,
    customIntervalDays?: number
): Date => {
    const next = new Date(current)

    switch (interval) {
        case 'daily':
            next.setUTCDate(next.getUTCDate() + 1)
            break
        case 'weekly':
            next.setUTCDate(next.getUTCDate() + 7)
            break
        case 'biweekly':
            next.setUTCDate(next.getUTCDate() + 14)
            break
        case 'monthly':
            next.setUTCMonth(next.getUTCMonth() + 1)
            break
        case 'quarterly':
            next.setUTCMonth(next.getUTCMonth() + 3)
            break
        case 'yearly':
            next.setUTCFullYear(next.getUTCFullYear() + 1)
            break
        case 'custom': {
            const days = customIntervalDays
            if (!days || days < 1) {
                throw new CustomError('customIntervalDays is required for custom intervals', 400)
            }
            next.setUTCDate(next.getUTCDate() + days)
            break
        }
    }

    return next
}

export const serializeRecurringRule = (rule: IRecurringRule): SerializedRecurringRule => {
    const plain = rule.toObject()
    return {
        ...plain,
        amount: fromMinorUnits(plain.amount),
    }
}

export const serializeRecurringRules = (rules: IRecurringRule[]): SerializedRecurringRule[] => {
    return rules.map(serializeRecurringRule)
}

const hasDraftForDueDate = async (
    userId: string,
    rule: IRecurringRule,
    dueDate: Date
): Promise<boolean> => {
    const dayStart = new Date(dueDate)
    const dayEnd = new Date(dueDate)
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)

    const existing = await Transaction.findOne({
        ...buildScopedListFilter(userId, rule.workspaceId?.toString() ?? null),
        recurringPaymentId: rule._id,
        status: 'draft',
        date: { $gte: dayStart, $lt: dayEnd },
    })

    return existing != null
}

export const generateDraftsForRule = async (
    rule: IRecurringRule,
    userId: string,
    endOfToday: Date
): Promise<SerializedTransaction[]> => {
    if (!rule.isActive || rule.isArchived) {
        return []
    }

    if (rule.type === 'transfer') {
        return []
    }

    await validateAccountForTransaction(rule.accountId.toString(), userId)
    await validateCategoryForTransaction(rule.categoryId.toString(), userId)

    const generated: SerializedTransaction[] = []
    let iterations = 0

    while (rule.nextDueDate <= endOfToday && iterations < MAX_CATCHUP_DRAFTS) {
        const dueDate = new Date(rule.nextDueDate)

        const duplicate = await hasDraftForDueDate(userId, rule, dueDate)
        if (!duplicate) {
            const draft = await Transaction.create({
                userId,
                workspaceId: rule.workspaceId ?? null,
                accountId: rule.accountId,
                categoryId: rule.categoryId,
                type: rule.type,
                status: 'draft',
                amount: rule.amount,
                currency: rule.currency,
                title: rule.title,
                description: rule.description,
                date: dueDate,
                paymentMethod: rule.paymentMethod,
                tags: rule.tags,
                recurringPaymentId: rule._id,
            })

            generated.push(serializeTransaction(draft))
        }

        rule.nextDueDate = advanceNextDueDate(
            rule.nextDueDate,
            rule.interval,
            rule.customIntervalDays
        )
        iterations += 1
    }

    if (iterations > 0) {
        await rule.save()
    }

    return generated
}

export const generateDraftsForUser = async (
    userId: string,
    endOfToday: Date,
    workspaceId?: string | null
): Promise<SerializedTransaction[]> => {
    const rules = await RecurringRule.find({
        ...buildScopedListFilter(userId, workspaceId ?? null),
        isActive: true,
        isArchived: false,
        nextDueDate: { $lte: endOfToday },
    }).sort({ nextDueDate: 1 })

    const allDrafts: SerializedTransaction[] = []

    for (const rule of rules) {
        const drafts = await generateDraftsForRule(rule, userId, endOfToday)
        allDrafts.push(...drafts)
    }

    return allDrafts
}

export const assertRecurringDraft = (transaction: ITransaction): void => {
    if (transaction.status !== 'draft') {
        throw new CustomError(ERROR_MESSAGES.RECURRING.NOT_A_DRAFT, 400)
    }
    if (!transaction.recurringPaymentId) {
        throw new CustomError(ERROR_MESSAGES.RECURRING.NOT_RECURRING_DRAFT, 400)
    }
}

export const confirmRecurringDraft = async (
    transaction: ITransaction,
    userId: string
): Promise<SerializedTransaction> => {
    assertRecurringDraft(transaction)

    const account = await validateAccountForTransaction(transaction.accountId.toString(), userId)

    transaction.status = 'posted'
    await transaction.save()
    await applyTransactionToAccount(account, transaction.type, transaction.amount)

    return serializeTransaction(transaction)
}

export const dismissRecurringDraft = async (transaction: ITransaction): Promise<void> => {
    assertRecurringDraft(transaction)
    await Transaction.deleteOne({ _id: transaction._id })
}

export const validateRuleReferences = async (
    userId: string,
    accountId: string,
    categoryId: string,
    workspaceId?: string | null
): Promise<{ account: Awaited<ReturnType<typeof validateAccountForTransaction>> }> => {
    const account = await validateAccountForTransaction(accountId, userId)
    assertAccountMatchesWorkspace(account.workspaceId, workspaceId)
    await validateCategoryForTransaction(categoryId, userId)
    return { account }
}
