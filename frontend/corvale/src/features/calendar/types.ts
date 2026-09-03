export type CalendarEventType = 'recurring' | 'budget_end' | 'goal_deadline'

export interface CalendarEvent {
    id: string
    type: CalendarEventType
    date: string
    title: string
    amount?: number
    refId: string
    accountId?: string
    categoryId?: string
}
