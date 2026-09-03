export type SavingsGoalStatus = 'active' | 'paused' | 'completed' | 'archived'
export type AutoContributionInterval = 'weekly' | 'monthly'
export type ContributionType = 'manual' | 'automatic'

export interface AutoContribution {
    enabled: boolean
    amount: number
    interval: AutoContributionInterval
    dayOfMonth?: number
    lastContributedAt?: string
    isDue: boolean
}

export interface SavingsGoalProgress {
    currentAmount: number
    targetAmount: number
    remaining: number
    percentComplete: number
    isComplete: boolean
    requiredMonthlyContribution: number | null
    projectedCompletionDate: string | null
    monthsRemaining: number | null
}

export interface SavingsGoal {
    _id: string
    userId: string
    workspaceId?: string | null
    name: string
    targetAmount: number
    currentAmount: number
    currency: string
    targetDate?: string | null
    status: SavingsGoalStatus
    accountId?: string | null
    autoContribution: AutoContribution
    completedAt?: string | null
    progress?: SavingsGoalProgress
    createdAt?: string
    updatedAt?: string
}

export interface SavingsGoalContribution {
    _id: string
    goalId: string
    amount: number
    type: ContributionType
    note?: string
    contributedAt: string
    createdAt?: string
}

export interface SavingsGoalFormData {
    name: string
    targetAmount: string
    currency: string
    targetDate: string
    accountId: string
    autoContributionEnabled: boolean
    autoContributionAmount: string
    autoContributionInterval: AutoContributionInterval
    autoContributionDayOfMonth: string
}

export interface ContributeResponse {
    message: string
    data: {
        goal: SavingsGoal
        contribution: SavingsGoalContribution
    }
}
