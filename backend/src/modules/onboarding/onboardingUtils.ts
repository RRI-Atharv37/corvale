export const ONBOARDING_STEPS = ['account', 'categories', 'budget', 'goal', 'tour'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export const OPTIONAL_ONBOARDING_STEPS: OnboardingStep[] = ['budget', 'goal', 'tour']

export const isOnboardingStep = (value: unknown): value is OnboardingStep =>
    typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value)

export const nextOnboardingStep = (step: OnboardingStep): OnboardingStep | null => {
    const index = ONBOARDING_STEPS.indexOf(step)
    if (index === -1 || index === ONBOARDING_STEPS.length - 1) {
        return null
    }
    return ONBOARDING_STEPS[index + 1]
}

export const calculateOnboardingProgress = (stepsCompleted: string[]): number =>
    Math.round((stepsCompleted.length / ONBOARDING_STEPS.length) * 100)
