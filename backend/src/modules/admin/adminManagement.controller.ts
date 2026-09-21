import type { Response } from 'express'
import asyncHandler from 'express-async-handler'

import { handleResponses } from '@core/http/response'

import { listAuditEntries } from './adminAudit.service'
import { requestContext, type AdminRequest } from './adminAuth.middleware'
import { inviteAdmin, listAdmins, resetAdminTotp, setAdminStatus } from './adminManagement.service'
import type { AdminPrincipal } from './adminTypes'
import { toAuditEntryView } from './adminViews'

const principalOf = (req: AdminRequest): AdminPrincipal => req.admin as AdminPrincipal

export const list = asyncHandler(async (_req: AdminRequest, res: Response) => {
    handleResponses(res, 200, { admins: await listAdmins() })
})

export const invite = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 201, await inviteAdmin(principalOf(req), req.body ?? {}, requestContext(req)))
})

export const resetTotp = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await resetAdminTotp(principalOf(req), req.params.adminId, req.body ?? {}, requestContext(req)))
})

export const setStatus = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await setAdminStatus(principalOf(req), req.params.adminId, req.body ?? {}, requestContext(req)))
})

export const auditLog = asyncHandler(async (req: AdminRequest, res: Response) => {
    const { entries, total, page, limit } = await listAuditEntries(req.query)

    handleResponses(res, 200, { entries: entries.map(toAuditEntryView), total, page, limit })
})
