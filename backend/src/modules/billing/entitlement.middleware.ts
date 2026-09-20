import type { NextFunction, RequestHandler, Response } from 'express'

import { getUserId } from '@core/auth/requestUser'
import { RESOURCE_LIMIT_KEY, type FeatureKey, type UsageResource } from '@core/billing/constants'
import { wouldExceedQuota, type Entitlements } from '@core/billing/entitlements'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import type { AuthRequest } from '@http/middleware/authTypes'
import { assertWorkspaceMembership } from '@modules/workspaces/access'

import type { BillingScope } from './billingScope'
import { getUsage, getUserEntitlements, isBillingEnabled } from './entitlement.service'

type Check = (req: AuthRequest, entitlements: Entitlements, subjectUserId: string) => Promise<void> | void

const paymentRequired = (message: string): CustomError => new CustomError(message, 402)

const assertCanWrite = (entitlements: Entitlements): void => {
    if (!entitlements.canWrite) throw paymentRequired(ERROR_MESSAGES.BILLING.READ_ONLY)
}

/**
 * The user whose subscription and usage govern this request: the caller for personal data, the
 * workspace owner for a workspace. Naming a workspace requires belonging to it, so a non-member
 * gets the same 403 the controllers give and learns nothing about the owner's billing state.
 */
const resolveSubject = async (req: AuthRequest, callerId: string, scope: BillingScope | undefined): Promise<string> => {
    const workspaceId = scope ? await scope(req) : null
    if (!workspaceId) return callerId

    const workspace = await assertWorkspaceMembership(workspaceId, callerId)
    return workspace.ownerId.toString()
}

/**
 * Entitlement is resolved from stored state only - never from the body, query or headers, which at
 * most select a scope that is then checked against membership. Runs after `protect`; a request
 * with no user is a 401, not a 402.
 */
const gate =
    (check: Check, scope?: BillingScope): RequestHandler =>
    async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
        try {
            const callerId = getUserId(req)
            if (isBillingEnabled()) {
                const subjectId = await resolveSubject(req, callerId, scope)
                const entitlements = await getUserEntitlements(subjectId)
                assertCanWrite(entitlements)
                await check(req, entitlements, subjectId)
            }
            next()
        } catch (error) {
            next(error)
        }
    }

/** A lapsed subscription is read-only: refuses with 402 READ_ONLY. Apply to every gated write. */
export const requireWriteAccess: RequestHandler = gate(() => undefined)

/** As `requireWriteAccess`, for a write that may land in a workspace (judged on its owner's plan). */
export const requireWriteAccessIn = (scope: BillingScope): RequestHandler => gate(() => undefined, scope)

/** Write access, plus the plan must include `feature` (402 ENTITLEMENT_REQUIRED otherwise). */
export const requireEntitlement = (feature: FeatureKey, scope?: BillingScope): RequestHandler =>
    gate((_req, entitlements) => {
        if (!entitlements.features[feature]) {
            throw paymentRequired(ERROR_MESSAGES.BILLING.ENTITLEMENT_REQUIRED)
        }
    }, scope)

/**
 * Write access, plus adding `amount` (default 1; a function receives the request, e.g. to read an
 * upload's size) must stay within the plan limit. Check-only: it does not reserve the usage, so a
 * caller that must be race-safe reserves atomically itself.
 */
export const requireQuota = (
    resource: UsageResource,
    amount: number | ((req: AuthRequest) => number) = 1,
    scope?: BillingScope
): RequestHandler =>
    gate(async (req, entitlements, subjectId) => {
        const requested = typeof amount === 'function' ? amount(req) : amount
        const used = await getUsage(subjectId, resource)

        if (wouldExceedQuota(entitlements.limits[RESOURCE_LIMIT_KEY[resource]], used, requested)) {
            throw paymentRequired(
                resource === 'syncDevices'
                    ? ERROR_MESSAGES.BILLING.SYNC_DEVICE_LIMIT
                    : ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED
            )
        }
    }, scope)
