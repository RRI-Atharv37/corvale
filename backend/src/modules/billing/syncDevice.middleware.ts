import type { NextFunction, RequestHandler, Response } from 'express'

import { getUserId } from '@core/auth/requestUser'
import type { AuthRequest } from '@http/middleware/authTypes'
import { logger } from '@infra/observability/logger'

import { scopeFromBody } from './billingScope'
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

/**
 * The decision, after the write gate: only the first `syncDevices` devices by first-seen order may
 * push. A workspace push is governed by the owner's plan, which the write gate already judged.
 */
export const requireSyncPushDevice: RequestHandler = async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
        if (isBillingEnabled() && !(await scopeFromBody(req))) {
            const callerId = getUserId(req)
            const deviceId = parseDeviceId((req.body as { deviceId?: unknown } | undefined)?.deviceId)
            const { limits } = await getUserEntitlements(callerId)
            if (!(await canDevicePush(callerId, deviceId, limits.syncDevices))) throw quotaExceededError('syncDevices')
        }
        next()
    } catch (error) {
        next(error)
    }
}
