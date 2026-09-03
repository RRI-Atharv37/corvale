export type NotificationType =
    | 'budget_over_limit'
    | 'bill_due'
    | 'savings_milestone'
    | 'workspace_invite'

export interface NotificationItem {
    _id: string
    type: NotificationType
    title: string
    message: string
    referenceType?: 'budget' | 'recurring_rule' | 'savings_goal'
    referenceId?: string
    readAt?: string | null
    dismissedAt?: string | null
    metadata?: Record<string, unknown>
    createdAt: string
}

export interface NotificationListPayload {
    notifications: NotificationItem[]
    unreadCount: number
}
