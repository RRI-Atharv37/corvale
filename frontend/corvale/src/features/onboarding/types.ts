export type OnboardingStep = 'account' | 'categories' | 'budget' | 'goal' | 'tour'

export interface OnboardingStatus {
    currentStep: OnboardingStep | null
    onboardingCompleted: boolean
    onboardingSkipped: boolean
    progressPercentage: number
    stepsCompleted: OnboardingStep[]
    accountCreated?: boolean
    accountId?: string
    categoriesReviewed?: boolean
    budgetCreated?: boolean
    budgetId?: string
    goalCreated?: boolean
    goalId?: string
    tourCompleted?: boolean
}
