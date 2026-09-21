import type { Response } from 'express'
import asyncHandler from 'express-async-handler'

import { GRANDFATHER_KINDS, PLAN_CODES, SUBSCRIPTION_STATUSES } from '@core/billing/constants'
import { DUNNING_STAGES } from '@core/billing/dunning'
import { ADMIN_GRANT_KINDS } from '@core/billing/entitlements'
import { RETENTION_STAGES } from '@core/billing/retention'
import { handleResponses } from '@core/http/response'

import { ADMIN_AUDIT_ACTIONS } from './adminAuditLog.model'
import { requestContext, type AdminRequest } from './adminAuth.middleware'
import { getGrantCapDays, getErasureHoldCapDays } from './adminConfig'
import { getSubscriberDetail, listSubscribers, lookupSubscribers } from './adminLookup.service'
import { getOpsHealth } from './adminOps.service'
import { ADMIN_ROLES } from './adminRoles'
import type { AdminPrincipal } from './adminTypes'

const principalOf = (req: AdminRequest): AdminPrincipal => req.admin as AdminPrincipal

/** The enums the admin UI needs, served rather than copied, so it never imports backend code. */
export const meta = asyncHandler(async (req: AdminRequest, res: Response) => {
    const { role } = principalOf(req)

    handleResponses(res, 200, {
        plans: PLAN_CODES,
        statuses: SUBSCRIPTION_STATUSES,
        grandfatherKinds: GRANDFATHER_KINDS,
        dunningStages: DUNNING_STAGES,
        retentionStages: RETENTION_STAGES,
        grantKinds: ADMIN_GRANT_KINDS,
        roles: ADMIN_ROLES,
        auditActions: ADMIN_AUDIT_ACTIONS,
        caps: { grantDays: getGrantCapDays(role), erasureHoldDays: getErasureHoldCapDays(role) },
    })
})

export const lookup = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await lookupSubscribers(req.query.q))
})

export const list = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await listSubscribers(req.query))
})

export const detail = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await getSubscriberDetail(req.params.userId, principalOf(req), requestContext(req)))
})

export const opsHealth = asyncHandler(async (_req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await getOpsHealth())
})
