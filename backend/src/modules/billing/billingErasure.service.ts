import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { logger } from '@infra/observability/logger'

import type { ProviderIdentifiers } from './billingEventRedaction'
import { isBillingEnabled } from './entitlement.service'
import { getBillingProvider } from './providers/providerRegistry'
import Subscription from './subscription.model'

const LIVE_STATUSES = ['trialing', 'active', 'past_due']

/**
 * First step of account erasure. A subscription that is still billing must be stopped at the
 * provider before anything is deleted; if that fails the erasure is refused, so nobody keeps being
 * charged after deleting their account. Returns the provider ids so the caller can redact the
 * ledger once the subscription row itself is gone.
 */
export const stopProviderBillingForErasure = async (userId: string): Promise<ProviderIdentifiers> => {
    const subscription = await Subscription.findOne({ userId }).setOptions({ [RLS_BYPASS]: true }).lean()
    if (!subscription) return {}

    const identifiers = {
        providerCustomerId: subscription.providerCustomerId,
        providerSubscriptionId: subscription.providerSubscriptionId,
    }

    if (!isBillingEnabled() || !subscription.providerSubscriptionId || !LIVE_STATUSES.includes(subscription.status)) {
        return identifiers
    }

    try {
        await getBillingProvider().cancelSubscription({
            providerSubscriptionId: subscription.providerSubscriptionId,
            immediate: true,
        })
    } catch (error) {
        logger.error('Could not cancel the provider subscription for an account erasure', {
            reason: error instanceof Error ? error.message : 'unknown',
        })
        throw new CustomError(ERROR_MESSAGES.BILLING.ERASURE_CANCEL_FAILED, 502)
    }

    return identifiers
}
