import type { NextFunction, RequestHandler, Response } from 'express'

import { getUserId } from '@core/auth/requestUser'
import { RESOURCE_LIMIT_KEY, type FeatureKey, type UsageResource } from '@core/billing/constants'
import { wouldExceedQuota, type Entitlements } from '@core/billing/entitlements'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import type { AuthRequest } from '@http/middleware/authTypes'

import { getUsage, getUserEntitlements } from './entitlement.service'

type Check = (req: AuthRequest, entitlements: Entitlements) => Promise<void> | void

const paymentRequired = (message: string): CustomError => new CustomError(message, 402)

const assertCanWrite = (entitlements: Entitlements): void => {
    if (!entitlements.canWrite) throw paymentRequired(ERROR_MESSAGES.BILLING.READ_ONLY)
}

/**
 * Entitlement is always resolved from the authenticated user's own subscription - never from the
 * body, query or headers. Runs after `protect`; a request with no user is a 401, not a 402.
 */
const gate =
    (check: Check): RequestHandler =>
    async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
        try {
            const entitlements = await getUserEntitlements(getUserId(req))
            if (entitlements.billingEnabled) {
                assertCanWrite(entitlements)
                await check(req, entitlements)
            }
            next()
        } catch (error) {
            next(error)
        }
    }

/** A lapsed subscription is read-only: refuses with 402 READ_ONLY. Apply to every gated write. */
export const requireWriteAccess: RequestHandler = gate(() => undefined)

/** Write access, plus the plan must include `feature` (402 ENTITLEMENT_REQUIRED otherwise). */
export const requireEntitlement = (feature: FeatureKey): RequestHandler =>
    gate((_req, entitlements) => {
        if (!entitlements.features[feature]) {
            throw paymentRequired(ERROR_MESSAGES.BILLING.ENTITLEMENT_REQUIRED)
        }
    })

/**
 * Write access, plus adding `amount` (default 1; a function receives the request, e.g. to read an
 * upload's size) must stay within the plan limit. Check-only: it does not reserve the usage, so a
 * caller that must be race-safe reserves atomically itself.
 */
export const requireQuota = (
    resource: UsageResource,
    amount: number | ((req: AuthRequest) => number) = 1
): RequestHandler =>
    gate(async (req, entitlements) => {
        const requested = typeof amount === 'function' ? amount(req) : amount
        const used = await getUsage(getUserId(req), resource)

        if (wouldExceedQuota(entitlements.limits[RESOURCE_LIMIT_KEY[resource]], used, requested)) {
            throw paymentRequired(
                resource === 'syncDevices'
                    ? ERROR_MESSAGES.BILLING.SYNC_DEVICE_LIMIT
                    : ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED
            )
        }
    })
