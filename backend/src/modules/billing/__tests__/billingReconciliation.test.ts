import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import app from '@http/app'
import { setErrorTrackingClient } from '@infra/observability/errorTracking'
import { setLoggerWriter } from '@infra/observability/logger'
import {
    Subscription,
    createFakeBillingProvider,
    reconcileBillingSubscriptions,
    type ProviderSubscriptionSnapshot,
} from '@modules/billing'
import { registerUser, type RegisteredUser } from '@tests/helpers'
import { DAY_MS, daysFromNow, disableBilling, enableBilling, setSubscription } from '@tests/billingHelpers'

/**
 * M3d - the reconciliation pass. It only ever reads and reports: a diff between the provider's
 * subscription list and the local `Subscription` rows, alerted through the logger and error
 * tracking. Repairing drift would mean trusting a listing over the webhook history, which is a
 * call for a human looking at the alert, not for a cron job.
 */

const NOW = new Date('2026-06-01T12:00:00.000Z')
const OLD = new Date(NOW.getTime() - 2 * DAY_MS)
const PERIOD_END = new Date('2026-07-01T00:00:00.000Z')

let user: RegisteredUser
let other: RegisteredUser
let captured: Array<{ err: unknown; context?: Record<string, unknown> }>
let logged: Array<Record<string, unknown>>

const idsOf = (u: RegisteredUser) => ({ providerCustomerId: `cus_${u.userId}`, providerSubscriptionId: `sub_${u.userId}` })

const remoteFor = (u: RegisteredUser, overrides: Partial<ProviderSubscriptionSnapshot> = {}): ProviderSubscriptionSnapshot => ({
    ...idsOf(u),
    planCode: 'pro',
    status: 'active',
    currentPeriodEnd: PERIOD_END,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    updatedAt: OLD,
    ...overrides,
})

const localFor = (u: RegisteredUser, overrides: Record<string, unknown> = {}) =>
    setSubscription(u.userId, {
        planCode: 'pro',
        status: 'active',
        currentPeriodEnd: PERIOD_END,
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        ...overrides,
    })

const run = async (remote: ProviderSubscriptionSnapshot[], options: Parameters<typeof reconcileBillingSubscriptions>[0] = {}) => {
    const { provider, remote: list } = createFakeBillingProvider()
    list.push(...remote)
    return reconcileBillingSubscriptions({ provider, now: NOW, ...options })
}

beforeEach(async () => {
    enableBilling()
    user = await registerUser(app)
    other = await registerUser(app)
    await Subscription.deleteMany({})

    captured = []
    logged = []
    setErrorTrackingClient({ captureException: (err, context) => void captured.push({ err, context }) })
    setLoggerWriter((line) => void logged.push(JSON.parse(line) as Record<string, unknown>))
})

afterEach(() => {
    disableBilling()
    setErrorTrackingClient(null)
    setLoggerWriter(null)
})

describe('when the two sides agree', () => {
    it('reports no drift, counts what it checked, and raises no alert', async () => {
        await localFor(user)
        await localFor(other, { planCode: 'plus' })

        const report = await run([remoteFor(user), remoteFor(other, { planCode: 'plus' })])

        expect(report).toMatchObject({ skipped: false, checked: 2, drift: [], deferred: 0 })
        expect(captured).toHaveLength(0)
        expect(logged.filter((line) => line.level === 'error')).toHaveLength(0)
    })

    it('treats two equal dates and two nulls as equal', async () => {
        await localFor(user, { currentPeriodEnd: null, trialEndsAt: new Date('2026-05-20T00:00:00.000Z') })

        const report = await run([remoteFor(user, { currentPeriodEnd: null, trialEndsAt: new Date('2026-05-20T00:00:00.000Z') })])

        expect(report.drift).toEqual([])
    })

    it('ignores a local row with no provider link (a trial that never checked out)', async () => {
        await localFor(user, { providerCustomerId: null, providerSubscriptionId: null, status: 'trialing', trialEndsAt: daysFromNow(10) })

        const report = await run([])

        expect(report).toMatchObject({ checked: 0, drift: [] })
    })
})

describe('when billing is off', () => {
    it('does nothing and never asks the provider', async () => {
        disableBilling()
        const { provider, calls } = createFakeBillingProvider()

        const report = await reconcileBillingSubscriptions({ provider, now: NOW })

        expect(report).toMatchObject({ skipped: true, checked: 0, drift: [] })
        expect(calls.listSubscriptions).toBe(0)
    })
})

describe('field drift', () => {
    it('names a status that differs', async () => {
        await localFor(user, { status: 'active' })

        const report = await run([remoteFor(user, { status: 'past_due' })])

        expect(report.drift).toEqual([{ kind: 'field_mismatch', providerSubscriptionId: idsOf(user).providerSubscriptionId, fields: ['status'] }])
    })

    it('names every field that differs at once', async () => {
        await localFor(user, { planCode: 'plus', currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: false, trialEndsAt: null })

        const report = await run([
            remoteFor(user, {
                planCode: 'pro',
                currentPeriodEnd: new Date(PERIOD_END.getTime() + DAY_MS),
                cancelAtPeriodEnd: true,
                trialEndsAt: new Date('2026-05-01T00:00:00.000Z'),
                providerCustomerId: 'cus_moved',
            }),
        ])

        expect(report.drift).toHaveLength(1)
        expect([...(report.drift[0].fields ?? [])].sort()).toEqual(
            ['cancelAtPeriodEnd', 'currentPeriodEnd', 'planCode', 'providerCustomerId', 'trialEndsAt'].sort()
        )
    })

    it('does not compare a field the provider did not state (a paused subscription has no mapped status)', async () => {
        await localFor(user, { status: 'active' })

        const report = await run([remoteFor(user, { status: undefined, planCode: undefined })])

        expect(report.drift).toEqual([])
    })

    it('never modifies the local subscription, whatever it finds', async () => {
        await localFor(user, { status: 'active', planCode: 'plus' })
        const before = await Subscription.findOne({ userId: user.userId }).lean()

        await run([remoteFor(user, { status: 'cancelled', planCode: 'pro' })])

        expect(await Subscription.findOne({ userId: user.userId }).lean()).toEqual(before)
    })
})

describe('rows only one side knows', () => {
    it('reports a provider subscription with no local row (a missed subscription.created)', async () => {
        const report = await run([remoteFor(user)])

        expect(report.drift).toEqual([{ kind: 'missing_locally', providerSubscriptionId: idsOf(user).providerSubscriptionId }])
    })

    it('reports a linked local subscription the provider no longer lists', async () => {
        await localFor(user, { status: 'active' })

        const report = await run([])

        expect(report.drift).toEqual([{ kind: 'missing_at_provider', providerSubscriptionId: idsOf(user).providerSubscriptionId }])
    })

    it('does not report a cancelled local subscription the provider has dropped', async () => {
        await localFor(user, { status: 'cancelled', currentPeriodEnd: daysFromNow(-3) })

        const report = await run([])

        expect(report.drift).toEqual([])
    })
})

describe('deliveries that may still be in flight', () => {
    it('defers a mismatch on a subscription the provider changed within the window', async () => {
        await localFor(user, { status: 'active' })
        const justNow = new Date(NOW.getTime() - 60_000)

        const report = await run([remoteFor(user, { status: 'past_due', updatedAt: justNow })])

        expect(report).toMatchObject({ drift: [], deferred: 1 })
        expect(captured).toHaveLength(0)
    })

    it('defers a provider subscription with no local row when it is new enough for its webhook to be on the way', async () => {
        const justNow = new Date(NOW.getTime() - 60_000)

        const report = await run([remoteFor(user, { updatedAt: justNow })])

        expect(report).toMatchObject({ drift: [], deferred: 1 })
    })

    it('reports the same mismatch once it is older than the window', async () => {
        await localFor(user, { status: 'active' })
        const stale = new Date(NOW.getTime() - 60 * 60_000)

        const report = await run([remoteFor(user, { status: 'past_due', updatedAt: stale })])

        expect(report.drift).toHaveLength(1)
        expect(report.deferred).toBe(0)
    })

    it('takes the window from the options', async () => {
        await localFor(user, { status: 'active' })
        const twentyMinutesAgo = new Date(NOW.getTime() - 20 * 60_000)

        const report = await run([remoteFor(user, { status: 'past_due', updatedAt: twentyMinutesAgo })], { inFlightWindowMs: 30 * 60_000 })

        expect(report).toMatchObject({ drift: [], deferred: 1 })
    })
})

describe('alerting', () => {
    it('logs an error and reports one exception summarising the drift', async () => {
        await localFor(user, { status: 'active' })

        await run([remoteFor(user, { status: 'past_due' }), remoteFor(other)])

        expect(logged.some((line) => line.level === 'error' && /drift/i.test(String(line.message)))).toBe(true)
        expect(captured).toHaveLength(1)
        expect(captured[0].err).toBeInstanceOf(Error)
        expect(captured[0].context).toMatchObject({ driftCount: 2, byKind: { field_mismatch: 1, missing_locally: 1 } })
    })

    it('carries provider ids and counts only - no user id, email or name', async () => {
        await localFor(user, { status: 'active', providerCustomerId: 'cus_opaque', providerSubscriptionId: 'sub_opaque' })

        await run([remoteFor(user, { status: 'past_due', providerCustomerId: 'cus_opaque', providerSubscriptionId: 'sub_opaque' })])

        const sent = JSON.stringify({ captured: captured.map((entry) => entry.context), logged })
        expect(sent).toContain('sub_opaque')
        expect(sent).not.toContain(user.userId)
        expect(sent).not.toContain(user.email)
    })

    it('caps the items in one alert but still reports the full count', async () => {
        const many = Array.from({ length: 75 }, (_, index) => ({ ...remoteFor(user), providerSubscriptionId: `sub_orphan_${index}`, providerCustomerId: `cus_orphan_${index}` }))

        const report = await run(many)

        expect(report.drift).toHaveLength(75)
        const context = captured[0].context as { driftCount: number; items: unknown[] }
        expect(context.driftCount).toBe(75)
        expect(context.items).toHaveLength(50)
    })

    it('reports a failure to list the provider and rethrows, so a silent outage is never mistaken for no drift', async () => {
        const { provider } = createFakeBillingProvider()
        const failing = { ...provider, listSubscriptions: vi.fn().mockRejectedValue(new Error('provider down')) }

        await expect(reconcileBillingSubscriptions({ provider: failing, now: NOW })).rejects.toThrow('provider down')

        expect(captured).toHaveLength(1)
        expect(String((captured[0].err as Error).message)).toMatch(/provider down|reconciliation/i)
    })
})

describe('defaults', () => {
    it('uses the installed provider when none is passed', async () => {
        const { setBillingProvider, resetBillingProvider } = await import('@modules/billing')
        const { provider, remote, calls } = createFakeBillingProvider()
        remote.push(remoteFor(user))
        setBillingProvider(provider)

        try {
            const report = await reconcileBillingSubscriptions({ now: NOW })

            expect(calls.listSubscriptions).toBe(1)
            expect(report.drift).toHaveLength(1)
        } finally {
            resetBillingProvider()
        }
    })
})
