import type { NextFunction, RequestHandler, Response } from 'express'

import { getUserId } from '@core/auth/requestUser'
import type { AuthRequest } from '@http/middleware/authTypes'
import { logger } from '@infra/observability/logger'

import { scopeFromBody } from './billingScope'
import { assertScopedWriteAccess } from './entitlement.middleware'
import { getUserEntitlements, isBillingEnabled } from './entitlement.service'
import type { DeviceKind } from './syncDevice.model'
import { canDevicePush, parseDeviceId, parseDeviceKind, registerSyncDevice } from './syncDevice.service'
import { quotaExceededError } from './usage.service'

const observeDevice = (source: 'query' | 'body'): RequestHandler =>
    async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
        try {
            const fields = (source === 'query' ? req.query : req.body) as { deviceId?: unknown; deviceKind?: unknown } | undefined

            let deviceId: string | undefined
            try {
                deviceId = parseDeviceId(fields?.deviceId)
            } catch (error) {
                if (isBillingEnabled()) throw error
                return next()
            }

            let kind: DeviceKind | undefined
            try {
                kind = parseDeviceKind(fields?.deviceKind)
            } catch (error) {
                if (isBillingEnabled()) throw error
            }

            try {
                await registerSyncDevice(getUserId(req), deviceId, new Date(), kind)
            } catch (error) {
                logger.warn('Sync device registration failed', { message: error instanceof Error ? error.message : 'unknown' })
            }
            next()
        } catch (error) {
            next(error)
        }
    }

/**
 * Devices are recorded on every sync call, whatever the billing state and whether or not the call
 * is then allowed: entitlement changes the decision, never what Corvale observes. A malformed id
 * is a 400 while billing is on and is ignored while it is off.
 */
export const trackSyncDevice: RequestHandler = observeDevice('query')
export const trackSyncPushDevice: RequestHandler = observeDevice('body')

const assertDeviceMayPush = async (callerId: string, rawDeviceId: unknown): Promise<void> => {
    const deviceId = parseDeviceId(rawDeviceId)
    const { limits } = await getUserEntitlements(callerId)
    if (!(await canDevicePush(callerId, deviceId, limits.syncDevices))) throw quotaExceededError('syncDevices')
}

/**
 * The decision, after the write gate: only the first `syncDevices` devices by first-seen order may
 * push. A workspace push is governed by the owner's plan, which the write gate already judged.
 */
export const requireSyncPushDevice: RequestHandler = async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
        if (isBillingEnabled() && !(await scopeFromBody(req))) {
            await assertDeviceMayPush(getUserId(req), (req.body as { deviceId?: unknown } | undefined)?.deviceId)
        }
        next()
    } catch (error) {
        next(error)
    }
}

/** Judges the scope a push op lands in (`null` = the caller's personal data); throws the 402 that rejects that op. */
export type SyncPushScopeGuard = (workspaceId: string | null) => Promise<void>

/**
 * SEC-71: the request envelope's `workspaceId` says which checkpoint the batch reports, not where each
 * op writes, so the write gate and the device limit are applied again per op scope. One verdict per
 * scope per batch.
 */
export const createSyncPushScopeGuard = (req: AuthRequest): SyncPushScopeGuard => {
    const callerId = getUserId(req)
    const rawDeviceId = (req.body as { deviceId?: unknown } | undefined)?.deviceId
    const verdicts = new Map<string, Promise<void>>()

    const judge = async (workspaceId: string | null): Promise<void> => {
        await assertScopedWriteAccess(callerId, workspaceId)
        if (!workspaceId && isBillingEnabled()) await assertDeviceMayPush(callerId, rawDeviceId)
    }

    return (workspaceId) => {
        const key = workspaceId ?? ''
        let verdict = verdicts.get(key)
        if (!verdict) {
            verdict = judge(workspaceId)
            verdicts.set(key, verdict)
        }
        return verdict
    }
}
