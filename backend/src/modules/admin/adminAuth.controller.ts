import type { Response } from 'express'
import asyncHandler from 'express-async-handler'

import { handleResponses } from '@core/http/response'

import {
    completeEnrolment,
    describeSession,
    loginAdmin,
    logoutAdmin,
    refreshAdminAccess,
    startEnrolment,
    stepUpAdmin,
} from './adminAuth.service'
import { requestContext, type AdminRequest } from './adminAuth.middleware'
import { clearAdminRefreshCookie, readAdminRefreshCookie, setAdminRefreshCookie } from './adminCookie'
import { capabilitiesOf } from './adminRoles'
import type { AdminPrincipal } from './adminTypes'

const principalOf = (req: AdminRequest): AdminPrincipal => req.admin as AdminPrincipal

export const login = asyncHandler(async (req: AdminRequest, res: Response) => {
    const result = await loginAdmin(req.body ?? {}, requestContext(req))

    setAdminRefreshCookie(res, result.refreshToken, result.sessionExpiresAt)
    handleResponses(res, 200, {
        accessToken: result.accessToken,
        expiresInSeconds: result.expiresInSeconds,
        sessionExpiresAt: result.sessionExpiresAt,
        stepUpUntil: result.stepUpUntil,
        admin: result.admin,
        capabilities: capabilitiesOf(result.admin.role),
    })
})

export const refresh = asyncHandler(async (req: AdminRequest, res: Response) => {
    const result = await refreshAdminAccess(readAdminRefreshCookie(req.cookies), requestContext(req))

    setAdminRefreshCookie(res, result.refreshToken, result.sessionExpiresAt)
    handleResponses(res, 200, {
        accessToken: result.accessToken,
        expiresInSeconds: result.expiresInSeconds,
        sessionExpiresAt: result.sessionExpiresAt,
        admin: result.admin,
        capabilities: capabilitiesOf(result.admin.role),
    })
})

export const logout = asyncHandler(async (req: AdminRequest, res: Response) => {
    const header = req.headers.authorization
    await logoutAdmin({
        refreshToken: readAdminRefreshCookie(req.cookies),
        accessToken: header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null,
    })

    clearAdminRefreshCookie(res)
    handleResponses(res, 200, { loggedOut: true })
})

export const stepUp = asyncHandler(async (req: AdminRequest, res: Response) => {
    const result = await stepUpAdmin(principalOf(req), req.body?.totpCode, requestContext(req))

    handleResponses(res, 200, { stepUpUntil: result.stepUpUntil })
})

export const me = asyncHandler(async (req: AdminRequest, res: Response) => {
    const principal = principalOf(req)

    handleResponses(res, 200, { ...describeSession(principal), capabilities: capabilitiesOf(principal.role) })
})

export const enrolStart = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await startEnrolment(req.body?.token))
})

export const enrolComplete = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await completeEnrolment(req.body ?? {}, requestContext(req)))
})
