export const PLAN_CODES = ['plus', 'pro'] as const
export type PlanCode = (typeof PLAN_CODES)[number]

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'trial_expired', 'cancelled'] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

export const GRANDFATHER_KINDS = ['free_forever', 'locked_rate', 'extended_trial'] as const
export type GrandfatherKind = (typeof GRANDFATHER_KINDS)[number]

export const USAGE_RESOURCES = ['receiptBytes', 'syncDevices', 'workspaceMembers'] as const
export type UsageResource = (typeof USAGE_RESOURCES)[number]

export const FEATURE_KEYS = ['workspaces', 'prioritySupport', 'bankSync'] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]

export const LIMIT_KEYS = ['receiptStorageBytes', 'syncDevices', 'workspaceMembers'] as const
export type LimitKey = (typeof LIMIT_KEYS)[number]

export const RESOURCE_LIMIT_KEY: Readonly<Record<UsageResource, LimitKey>> = {
    receiptBytes: 'receiptStorageBytes',
    syncDevices: 'syncDevices',
    workspaceMembers: 'workspaceMembers',
}
