import { Types } from 'mongoose'

import Budget from '../models/Budget'
import Notification, {
    INotification,
    NotificationReferenceType,
    NotificationType,
} from '../models/Notification'
import RecurringRule from '../models/RecurringRule'
import { ISavingsGoal } from '../models/SavingsGoal'
import { IUser } from '../models/User'
import { attachProgressToBudget, computeBudgetProgress, computeBudgetSpentMinor } from './budgetUtils'
import { DEFAULT_CURRENCY, formatCurrencyAmount } from './currencyUtils'
import { fromMinorUnits } from './moneyUtils'
import { endOfDayInTimezone, startOfDayInTimezone } from './timezoneUtils'
import { buildScopedListFilter } from './workspaceUtils'

export const SAVINGS_MILESTONES = [25, 50, 75, 100] as const

export interface NotificationPreferences {
    billRemindersEnabled: boolean
    billReminderDaysBefore: number
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
    billRemindersEnabled: true,
    billReminderDaysBefore: 3,
}

export interface SerializedNotification {
    _id: Types.ObjectId
    type: NotificationType
    title: string
    message: string
    referenceType?: NotificationReferenceType
    referenceId?: Types.ObjectId
    readAt?: Date | null
    dismissedAt?: Date | null
    metadata?: Record<string, unknown>
    createdAt: Date
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

const formatMoney = (amountMajor: number, currency: string): string =>
    formatCurrencyAmount(amountMajor, currency)

const getTodayDateStr = (timezone: string): string => {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
}

const addDaysToDateStr = (dateStr: string, days: number): string => {
    const [year, month, day] = dateStr.split('-').map(Number)
    const utc = new Date(Date.UTC(year, month - 1, day + days))
    return utc.toISOString().slice(0, 10)
}

export const parseNotificationPreferences = (
    value: unknown
): Partial<NotificationPreferences> | undefined => {
    if (value === undefined) {
        return undefined
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('notificationPreferences must be an object')
    }

    const prefs = value as Record<string, unknown>
    const parsed: Partial<NotificationPreferences> = {}

    if (prefs.billRemindersEnabled !== undefined) {
        if (typeof prefs.billRemindersEnabled !== 'boolean') {
            throw new Error('billRemindersEnabled must be a boolean')
        }
        parsed.billRemindersEnabled = prefs.billRemindersEnabled
    }

    if (prefs.billReminderDaysBefore !== undefined) {
        const days = Number(prefs.billReminderDaysBefore)
        if (!Number.isInteger(days) || days < 0 || days > 30) {
            throw new Error('billReminderDaysBefore must be an integer between 0 and 30')
        }
        parsed.billReminderDaysBefore = days
    }

    return parsed
}

export const resolveNotificationPreferences = (user: IUser): NotificationPreferences => {
    const stored = user.notificationPreferences
    return {
        billRemindersEnabled:
            stored?.billRemindersEnabled ?? DEFAULT_NOTIFICATION_PREFERENCES.billRemindersEnabled,
        billReminderDaysBefore:
            stored?.billReminderDaysBefore ?? DEFAULT_NOTIFICATION_PREFERENCES.billReminderDaysBefore,
    }
}

export const serializeNotification = (notification: INotification): SerializedNotification => {
    return {
        _id: notification._id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        referenceType: notification.referenceType,
        referenceId: notification.referenceId,
        readAt: notification.readAt ?? null,
        dismissedAt: notification.dismissedAt ?? null,
        metadata: notification.metadata,
        createdAt: notification.createdAt,
    }
}

interface CreateNotificationInput {
    userId: string
    type: NotificationType
    title: string
    message: string
    dedupeKey: string
    referenceType?: NotificationReferenceType
    referenceId?: Types.ObjectId
    metadata?: Record<string, unknown>
}

export const createNotificationIfNew = async (input: CreateNotificationInput): Promise<void> => {
    await Notification.findOneAndUpdate(
        { userId: input.userId, dedupeKey: input.dedupeKey },
        {
            $setOnInsert: {
                userId: input.userId,
                type: input.type,
                title: input.title,
                message: input.message,
                dedupeKey: input.dedupeKey,
                referenceType: input.referenceType,
                referenceId: input.referenceId,
                metadata: input.metadata,
                readAt: null,
                dismissedAt: null,
            },
        },
        { upsert: true }
    )
}

export const evaluateBudgetOverLimitNotifications = async (
    userId: string,
    transaction: {
        type: string
        status: string
        date: Date
        accountId: Types.ObjectId
        categoryId: Types.ObjectId
        workspaceId?: Types.ObjectId | null
    }
): Promise<void> => {
    if (transaction.type !== 'expense' || transaction.status !== 'posted') {
        return
    }

    const scopeFilter = buildScopedListFilter(
        userId,
        transaction.workspaceId?.toString() ?? null
    )

    const budgets = await Budget.find({
        ...scopeFilter,
        isArchived: false,
        periodStart: { $lte: transaction.date },
        periodEnd: { $gte: transaction.date },
    })

    for (const budget of budgets) {
        if (
            budget.accountIds.length > 0 &&
            !budget.accountIds.some((id) => id.equals(transaction.accountId))
        ) {
            continue
        }

        if (budget.categoryId && !budget.categoryId.equals(transaction.categoryId)) {
            continue
        }

        const spentMinor = await computeBudgetSpentMinor(budget)
        const progress = computeBudgetProgress(budget.amount, spentMinor)
        if (!progress.isOverBudget) {
            continue
        }

        const budgetLabel = budget.name?.trim() || 'Budget'
        const currency = budget.currency || DEFAULT_CURRENCY
        const dedupeKey = `budget_over_limit:${budget._id.toString()}:${budget.periodStart.toISOString()}`

        await createNotificationIfNew({
            userId,
            type: 'budget_over_limit',
            title: 'Budget exceeded',
            message: `${budgetLabel} is over budget at ${progress.percentUsed}% (${formatMoney(progress.spent, currency)} of ${formatMoney(progress.budgetAmount, currency)}).`,
            referenceType: 'budget',
            referenceId: budget._id,
            dedupeKey,
            metadata: {
                percentUsed: progress.percentUsed,
                spent: progress.spent,
                budgetAmount: progress.budgetAmount,
                budgetName: budgetLabel,
                currency,
            },
        })
    }
}

export const evaluateSavingsMilestoneNotifications = async (
    userId: string,
    goal: ISavingsGoal,
    previousAmountMinor: number
): Promise<void> => {
    if (goal.targetAmount <= 0) {
        return
    }

    const previousPercent = Math.min(
        Math.round((previousAmountMinor / goal.targetAmount) * 10000) / 100,
        100
    )
    const currentPercent = Math.min(
        Math.round((goal.currentAmount / goal.targetAmount) * 10000) / 100,
        100
    )

    for (const milestone of SAVINGS_MILESTONES) {
        if (previousPercent >= milestone || currentPercent < milestone) {
            continue
        }

        const dedupeKey = `savings_milestone:${goal._id.toString()}:${milestone}`
        const title =
            milestone === 100 ? 'Savings goal reached!' : `${milestone}% milestone reached`
        const message =
            milestone === 100
                ? `You reached your "${goal.name}" savings goal target.`
                : `"${goal.name}" is now ${milestone}% funded.`

        await createNotificationIfNew({
            userId,
            type: 'savings_milestone',
            title,
            message,
            referenceType: 'savings_goal',
            referenceId: goal._id,
            dedupeKey,
            metadata: {
                milestone,
                goalName: goal.name,
                percentComplete: currentPercent,
            },
        })
    }
}

export const syncBillDueNotifications = async (
    userId: string,
    user: IUser,
    timezone: string,
    workspaceId?: string | null
): Promise<void> => {
    const preferences = resolveNotificationPreferences(user)
    if (!preferences.billRemindersEnabled) {
        return
    }

    const todayStr = getTodayDateStr(timezone)
    const windowEndStr = addDaysToDateStr(todayStr, preferences.billReminderDaysBefore)
    const windowStart = startOfDayInTimezone(todayStr, timezone)
    const windowEnd = endOfDayInTimezone(windowEndStr, timezone)

    const rules = await RecurringRule.find({
        ...buildScopedListFilter(userId, workspaceId ?? null),
        type: 'expense',
        isActive: true,
        isArchived: false,
        nextDueDate: { $gte: windowStart, $lte: windowEnd },
    })

    for (const rule of rules) {
        const dueDateStr = rule.nextDueDate.toISOString().slice(0, 10)
        const dedupeKey = `bill_due:${rule._id.toString()}:${dueDateStr}`
        const amount = fromMinorUnits(rule.amount)
        const currency = rule.currency || DEFAULT_CURRENCY
        const daysUntilDue = Math.max(
            0,
            Math.ceil((startOfDayInTimezone(dueDateStr, timezone).getTime() - windowStart.getTime()) / MS_PER_DAY)
        )
        const dueLabel =
            daysUntilDue === 0
                ? 'due today'
                : daysUntilDue === 1
                  ? 'due tomorrow'
                  : `due in ${daysUntilDue} days`

        await createNotificationIfNew({
            userId,
            type: 'bill_due',
            title: 'Upcoming bill',
            message: `"${rule.title}" (${formatMoney(amount, currency)}) is ${dueLabel}.`,
            referenceType: 'recurring_rule',
            referenceId: rule._id,
            dedupeKey,
            metadata: {
                ruleTitle: rule.title,
                amount,
                currency,
                dueDate: dueDateStr,
                daysUntilDue,
            },
        })
    }
}

export const attachBudgetContextToNotifications = async (
    notifications: INotification[],
    userId: string
): Promise<SerializedNotification[]> => {
    const budgetIds = notifications
        .filter((n) => n.referenceType === 'budget' && n.referenceId)
        .map((n) => n.referenceId!)

    const budgets =
        budgetIds.length > 0
            ? await Budget.find({ _id: { $in: budgetIds }, userId })
            : []

    const budgetMap = new Map(budgets.map((b) => [b._id.toString(), b]))

    return Promise.all(
        notifications.map(async (notification) => {
            const serialized = serializeNotification(notification)

            if (notification.referenceType === 'budget' && notification.referenceId) {
                const budget = budgetMap.get(notification.referenceId.toString())
                if (budget) {
                    const withProgress = await attachProgressToBudget(budget)
                    serialized.metadata = {
                        ...serialized.metadata,
                        progress: withProgress.progress,
                    }
                }
            }

            return serialized
        })
    )
}
