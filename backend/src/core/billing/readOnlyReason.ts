import {
    DEFAULT_PAST_DUE_GRACE_DAYS,
    deriveProviderState,
    type Entitlements,
    type SubscriptionSnapshot,
} from './entitlements'

export const WRITE_ACCESS_CODES = [
    'billing_off',
    'no_subscription',
    'free_forever',
    'admin_comp',
    'trialing',
    'active',
    'active_cancelling',
    'past_due_in_grace',
    'trial_expired',
    'cancelled',
    'cancel_period_ended',
    'past_due_grace_ended',
] as const
export type WriteAccessCode = (typeof WRITE_ACCESS_CODES)[number]

export interface WriteAccessExplanation {
    canWrite: boolean
    code: WriteAccessCode
    message: string
}

const day = (date: Date | null): string => (date ? date.toISOString().slice(0, 10) : 'an unknown date')

const READ_ONLY_TAIL = 'Everything can still be read and exported.'

/**
 * The plain-language answer to "why is this user read-only?", built from the resolver's own verdict and the
 * provider-owned state, so the sentence can never disagree with what the API actually does.
 */
export const explainWriteAccess = (
    entitlements: Entitlements,
    subscription: SubscriptionSnapshot | null,
    now: Date,
    options: { pastDueGraceDays?: number } = {}
): WriteAccessExplanation => {
    if (!entitlements.billingEnabled) {
        return { canWrite: true, code: 'billing_off', message: 'Billing is switched off on this server, so nothing is restricted.' }
    }

    if (!subscription) {
        return {
            canWrite: false,
            code: 'no_subscription',
            message: `This account has no subscription record, so it is read-only. ${READ_ONLY_TAIL}`,
        }
    }

    if (subscription.grandfatherKind === 'free_forever') {
        return { canWrite: true, code: 'free_forever', message: 'Grandfathered as free forever: writing is always allowed.' }
    }

    const provider = deriveProviderState(subscription, now, options.pastDueGraceDays ?? DEFAULT_PAST_DUE_GRACE_DAYS)

    if (entitlements.canWrite && !provider.canWrite) {
        const until = subscription.adminGrant?.until ?? null
        return {
            canWrite: true,
            code: 'admin_comp',
            message: `A complimentary grant from Corvale staff allows writing until ${day(until)}. Without it this account would be read-only (${provider.status.replace('_', ' ')}).`,
        }
    }

    if (provider.canWrite) {
        switch (provider.status) {
            case 'trialing':
                return { canWrite: true, code: 'trialing', message: `On a free trial that ends on ${day(subscription.trialEndsAt)}.` }
            case 'past_due':
                return {
                    canWrite: true,
                    code: 'past_due_in_grace',
                    message: `A payment failed. Writing stays on until the grace period closes on ${day(entitlements.graceEndsAt ?? provider.graceEndsAt)}.`,
                }
            default:
                return subscription.cancelAtPeriodEnd
                    ? {
                          canWrite: true,
                          code: 'active_cancelling',
                          message: `Active but set to cancel: writing ends on ${day(subscription.currentPeriodEnd)}.`,
                      }
                    : { canWrite: true, code: 'active', message: 'Active subscription; writing is allowed.' }
        }
    }

    switch (provider.status) {
        case 'trial_expired':
            return {
                canWrite: false,
                code: 'trial_expired',
                message: `The free trial ended on ${day(subscription.trialEndsAt)} and no plan was started. ${READ_ONLY_TAIL}`,
            }
        case 'past_due':
            return {
                canWrite: false,
                code: 'past_due_grace_ended',
                message: `A payment failed and the grace period closed on ${day(provider.graceEndsAt)}. ${READ_ONLY_TAIL}`,
            }
        default:
            return subscription.status === 'cancelled'
                ? {
                      canWrite: false,
                      code: 'cancelled',
                      message: `The subscription was cancelled. ${READ_ONLY_TAIL}`,
                  }
                : {
                      canWrite: false,
                      code: 'cancel_period_ended',
                      message: `The subscription was set to cancel and its period ended on ${day(subscription.currentPeriodEnd)}. ${READ_ONLY_TAIL}`,
                  }
    }
}
