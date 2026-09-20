import type { NextFunction, Response } from 'express'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'

import {
    Plan,
    Subscription,
    UsageCounter,
    requireEntitlement,
    requireQuota,
    requireWriteAccess,
} from '@modules/billing'
import type { AuthRequest } from '@http/middleware/authTypes'
import { runWithRlsContext } from '@core/access/rowLevelSecurity'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

/**
 * M2b - `requireWriteAccess`, `requireEntitlement(feature)` and `requireQuota(resource, amount)`
 * driven directly with a stubbed request, inside an RLS context exactly as `protect` leaves it.
 * Wiring them onto real routes (and the end-to-end HTTP specs in tests/billing/) is M4; here we
 * pin the middleware contract: 402 with a BILLING.* message, before the handler runs, and nothing
 * at all while billing is off.
 */

const DAY = 24 * 60 * 60 * 1000

interface Outcome {
    nextCalled: boolean
    error: CustomError | null
}

const run = async (
    userId: string,
    middleware: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void> | void,
    reqExtras: Record<string, unknown> = {}
): Promise<Outcome> => {
    const outcome: Outcome = { nextCalled: false, error: null }
    const req = { user: { _id: new Types.ObjectId(userId) }, ...reqExtras } as unknown as AuthRequest
    const next: NextFunction = (err?: unknown) => {
        outcome.nextCalled = true
        outcome.error = (err as CustomError | undefined) ?? null
    }
    await runWithRlsContext({ userId }, async () => {
        await middleware(req, {} as Response, next)
    })
    return outcome
}

const expectAllowed = (outcome: Outcome): void => {
    expect(outcome.nextCalled).toBe(true)
    expect(outcome.error).toBeNull()
}

const expectRefused = (outcome: Outcome, message: string): void => {
    expect(outcome.nextCalled).toBe(true)
    expect(outcome.error).toBeInstanceOf(CustomError)
    expect(outcome.error?.statusCode).toBe(402)
    expect(outcome.error?.message).toBe(message)
}

const seedPlans = async (): Promise<void> => {
    await Plan.create([
        {
            code: 'plus',
            name: 'Plus',
            features: { workspaces: false, prioritySupport: false, bankSync: false },
            limits: { receiptStorageBytes: 100, syncDevices: 1, workspaceMembers: null },
        },
        {
            code: 'pro',
            name: 'Pro',
            features: { workspaces: true, prioritySupport: true, bankSync: true },
            limits: { receiptStorageBytes: 1000, syncDevices: null, workspaceMembers: 3 },
        },
    ])
}

const subscribe = (userId: string, fields: Record<string, unknown> = {}) =>
    Subscription.create({
        userId,
        planCode: 'plus',
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * DAY),
        ...fields,
    })

const LAPSED: Array<[string, Record<string, unknown>]> = [
    ['trial_expired', { status: 'trial_expired', trialEndsAt: new Date(Date.now() - DAY) }],
    ['trialing but lapsed', { status: 'trialing', trialEndsAt: new Date(Date.now() - DAY) }],
    ['cancelled', { status: 'cancelled', currentPeriodEnd: new Date(Date.now() - DAY) }],
    ['past_due, grace elapsed', { status: 'past_due', pastDueSince: new Date(Date.now() - 90 * DAY) }],
]

let userId: string

beforeEach(async () => {
    userId = new Types.ObjectId().toString()
    process.env.BILLING_ENABLED = 'true'
    await seedPlans()
})

afterEach(() => {
    delete process.env.BILLING_ENABLED
})

describe('requireWriteAccess', () => {
    it.each(['active', 'trialing'])('lets a %s subscription through', async (status) => {
        await subscribe(userId, { status, trialEndsAt: new Date(Date.now() + DAY) })

        expectAllowed(await run(userId, requireWriteAccess))
    })

    it('lets a past_due subscription through inside its grace window', async () => {
        await subscribe(userId, { status: 'past_due', pastDueSince: new Date(Date.now() - DAY) })

        expectAllowed(await run(userId, requireWriteAccess))
    })

    it.each(LAPSED)('refuses %s with 402 READ_ONLY', async (_name, fields) => {
        await subscribe(userId, fields)

        expectRefused(await run(userId, requireWriteAccess), ERROR_MESSAGES.BILLING.READ_ONLY)
    })

    it('refuses a user with no subscription with 402 READ_ONLY', async () => {
        expectRefused(await run(userId, requireWriteAccess), ERROR_MESSAGES.BILLING.READ_ONLY)
    })

    it('lets a free_forever grandfathered user write whatever the stored status', async () => {
        await subscribe(userId, { status: 'cancelled', grandfatherKind: 'free_forever' })

        expectAllowed(await run(userId, requireWriteAccess))
    })

    it('does nothing while billing is off, even with a lapsed row', async () => {
        delete process.env.BILLING_ENABLED
        await subscribe(userId, LAPSED[0][1])

        expectAllowed(await run(userId, requireWriteAccess))
    })

    it('an unauthenticated request is a 401, not a billing refusal', async () => {
        const outcome: Outcome = { nextCalled: false, error: null }
        await requireWriteAccess({} as AuthRequest, {} as Response, ((err?: unknown) => {
            outcome.nextCalled = true
            outcome.error = (err as CustomError | undefined) ?? null
        }) as NextFunction)

        expect(outcome.error?.statusCode).toBe(401)
    })
})

describe('requireEntitlement(feature)', () => {
    it('refuses a plan lacking the feature with 402 ENTITLEMENT_REQUIRED', async () => {
        await subscribe(userId, { planCode: 'plus' })

        expectRefused(
            await run(userId, requireEntitlement('workspaces')),
            ERROR_MESSAGES.BILLING.ENTITLEMENT_REQUIRED
        )
    })

    it('allows a plan that has the feature', async () => {
        await subscribe(userId, { planCode: 'pro' })

        expectAllowed(await run(userId, requireEntitlement('workspaces')))
    })

    it('a trial gets the trial plan features', async () => {
        await subscribe(userId, { planCode: 'pro', status: 'trialing', trialEndsAt: new Date(Date.now() + DAY) })

        expectAllowed(await run(userId, requireEntitlement('workspaces')))
    })

    it('checks each feature independently', async () => {
        await subscribe(userId, { planCode: 'plus' })

        expectRefused(await run(userId, requireEntitlement('bankSync')), ERROR_MESSAGES.BILLING.ENTITLEMENT_REQUIRED)
        expectRefused(
            await run(userId, requireEntitlement('prioritySupport')),
            ERROR_MESSAGES.BILLING.ENTITLEMENT_REQUIRED
        )
    })

    it.each(LAPSED)('a lapsed subscription (%s) is READ_ONLY even on a plan with the feature', async (_n, fields) => {
        await subscribe(userId, { planCode: 'pro', ...fields })

        expectRefused(await run(userId, requireEntitlement('workspaces')), ERROR_MESSAGES.BILLING.READ_ONLY)
    })

    it('reads fresh state: an upgrade applies on the very next call', async () => {
        await subscribe(userId, { planCode: 'plus' })
        expectRefused(await run(userId, requireEntitlement('workspaces')), ERROR_MESSAGES.BILLING.ENTITLEMENT_REQUIRED)

        await Subscription.updateOne({ userId }, { $set: { planCode: 'pro' } })

        expectAllowed(await run(userId, requireEntitlement('workspaces')))
    })

    it('ignores anything the client puts in the body, query or headers', async () => {
        await subscribe(userId, { planCode: 'plus' })

        const outcome = await run(userId, requireEntitlement('workspaces'), {
            body: { planCode: 'pro', entitlements: { features: { workspaces: true } } },
            query: { planCode: 'pro' },
            headers: { 'x-plan': 'pro' },
        })

        expectRefused(outcome, ERROR_MESSAGES.BILLING.ENTITLEMENT_REQUIRED)
    })

    it('does nothing while billing is off', async () => {
        delete process.env.BILLING_ENABLED

        expectAllowed(await run(userId, requireEntitlement('workspaces')))
    })
})

describe('requireQuota(resource, amount)', () => {
    const setUsage = (resource: string, value: number) => UsageCounter.create({ userId, resource, value })

    beforeEach(async () => {
        await subscribe(userId, { planCode: 'plus' })
    })

    it('allows usage that lands exactly on the limit', async () => {
        await setUsage('receiptBytes', 60)

        expectAllowed(await run(userId, requireQuota('receiptBytes', 40)))
    })

    it('refuses usage past the limit with 402 QUOTA_EXCEEDED', async () => {
        await setUsage('receiptBytes', 60)

        expectRefused(await run(userId, requireQuota('receiptBytes', 41)), ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED)
    })

    it('treats a missing counter as zero usage', async () => {
        expectAllowed(await run(userId, requireQuota('receiptBytes', 100)))
        expectRefused(await run(userId, requireQuota('receiptBytes', 101)), ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED)
    })

    it('a null limit is unlimited', async () => {
        await setUsage('workspaceMembers', 1_000_000)

        expectAllowed(await run(userId, requireQuota('workspaceMembers', 1_000_000)))
    })

    it('uses SYNC_DEVICE_LIMIT for the device resource', async () => {
        await setUsage('syncDevices', 1)

        expectRefused(await run(userId, requireQuota('syncDevices', 1)), ERROR_MESSAGES.BILLING.SYNC_DEVICE_LIMIT)
    })

    it('resolves a per-request amount from the request', async () => {
        const amount = (req: AuthRequest): number => (req as unknown as { file: { size: number } }).file.size

        expectAllowed(await run(userId, requireQuota('receiptBytes', amount), { file: { size: 100 } }))
        expectRefused(
            await run(userId, requireQuota('receiptBytes', amount), { file: { size: 101 } }),
            ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED
        )
    })

    it('defaults the amount to one unit', async () => {
        await setUsage('syncDevices', 0)

        expectAllowed(await run(userId, requireQuota('syncDevices')))
    })

    it('fails closed on an invalid amount', async () => {
        const nan = (): number => Number.NaN

        expectRefused(await run(userId, requireQuota('receiptBytes', nan)), ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED)
    })

    it('is per user: another user’s usage does not count', async () => {
        const other = new Types.ObjectId().toString()
        await UsageCounter.create({ userId: other, resource: 'receiptBytes', value: 100 })

        expectAllowed(await run(userId, requireQuota('receiptBytes', 100)))
    })

    it('a lapsed subscription is READ_ONLY before any quota is evaluated', async () => {
        await Subscription.updateOne({ userId }, { $set: LAPSED[0][1] })

        expectRefused(await run(userId, requireQuota('receiptBytes', 1)), ERROR_MESSAGES.BILLING.READ_ONLY)
    })

    it('upgrading raises the limit on the next call', async () => {
        await setUsage('receiptBytes', 100)
        expectRefused(await run(userId, requireQuota('receiptBytes', 1)), ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED)

        await Subscription.updateOne({ userId }, { $set: { planCode: 'pro' } })

        expectAllowed(await run(userId, requireQuota('receiptBytes', 1)))
    })

    it('does nothing while billing is off', async () => {
        delete process.env.BILLING_ENABLED
        await setUsage('receiptBytes', 10_000)

        expectAllowed(await run(userId, requireQuota('receiptBytes', 10_000)))
    })
})

describe('BILLING error messages', () => {
    it('defines every key the M1 specs reference, all distinct and non-empty', () => {
        const keys = [
            'ENTITLEMENT_REQUIRED',
            'READ_ONLY',
            'QUOTA_EXCEEDED',
            'SYNC_DEVICE_LIMIT',
            'WEBHOOK_SIGNATURE_INVALID',
            'WEBHOOK_PAYLOAD_INVALID',
            'NO_BILLING_CUSTOMER',
        ] as const
        const values = keys.map((k) => ERROR_MESSAGES.BILLING[k])

        for (const v of values) expect(v.length).toBeGreaterThan(0)
        expect(new Set(values).size).toBe(keys.length)
    })
})
