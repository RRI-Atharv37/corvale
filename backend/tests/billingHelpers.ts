import crypto from 'node:crypto'
import request from 'supertest'
import { Application } from 'express'
import { Types } from 'mongoose'

import {
    Plan,
    Subscription,
    setBillingProvider,
    resetBillingProvider,
    createFakeBillingProvider,
    FAKE_SIGNATURE_HEADER,
    FAKE_WEBHOOK_SECRET,
    signFakePayload,
    type FakeProviderCalls,
    type NormalizedBillingEvent,
} from '@modules/billing'
import { Workspace, WorkspaceInvite } from '@modules/workspaces'
import type { SubscriptionStatus } from '@core/billing/entitlements'
import { authHeader } from '@tests/helpers'

/**
 * Shared harness for the M1 acceptance suite (M-track). Everything here targets the contracts
 * pinned in ROADMAP § *Entitlement architecture* / *Billing integration contract* / *Trial and
 * downgrade semantics*; nothing depends on which Merchant of Record is selected in M0 - the
 * webhook tests drive the route through a fake `BillingProvider` installed with
 * `setBillingProvider`.
 */

export const DAY_MS = 24 * 60 * 60 * 1000
export const daysFromNow = (days: number): Date => new Date(Date.now() + days * DAY_MS)

export const enableBilling = (): void => {
    process.env.BILLING_ENABLED = 'true'
}

export const disableBilling = (): void => {
    delete process.env.BILLING_ENABLED
}

export interface TestPlanOverrides {
    features?: Partial<{ workspaces: boolean; prioritySupport: boolean; bankSync: boolean }>
    limits?: Partial<{
        receiptStorageBytes: number | null
        syncDevices: number | null
        workspaceMembers: number | null
    }>
}

/** Small, test-sized limits; the real catalogue values are pinned in `planCatalogue.test.ts`. */
export const seedTestPlans = async (
    overrides: { plus?: TestPlanOverrides; pro?: TestPlanOverrides } = {}
): Promise<void> => {
    await Plan.deleteMany({})
    await Plan.create([
        {
            code: 'plus',
            name: 'Plus',
            features: { workspaces: false, prioritySupport: false, bankSync: false, ...overrides.plus?.features },
            limits: {
                receiptStorageBytes: 1024 * 1024,
                syncDevices: 1,
                workspaceMembers: null,
                ...overrides.plus?.limits,
            },
        },
        {
            code: 'pro',
            name: 'Pro',
            features: { workspaces: true, prioritySupport: true, bankSync: true, ...overrides.pro?.features },
            limits: {
                receiptStorageBytes: 10 * 1024 * 1024,
                syncDevices: null,
                workspaceMembers: null,
                ...overrides.pro?.limits,
            },
        },
    ])
}

export interface SubscriptionOverrides {
    planCode?: 'plus' | 'pro'
    status?: SubscriptionStatus
    trialEndsAt?: Date | null
    currentPeriodEnd?: Date | null
    cancelAtPeriodEnd?: boolean
    pastDueSince?: Date | null
    grandfatherKind?: null | 'free_forever' | 'locked_rate' | 'extended_trial'
    providerCustomerId?: string | null
    providerSubscriptionId?: string | null
    lastEventAt?: Date | null
}

export const setSubscription = async (
    userId: string,
    overrides: SubscriptionOverrides = {}
): Promise<void> => {
    const doc = {
        planCode: 'pro',
        status: 'active',
        trialEndsAt: null,
        currentPeriodEnd: daysFromNow(30),
        cancelAtPeriodEnd: false,
        pastDueSince: null,
        grandfatherKind: null,
        providerCustomerId: `cus_${userId}`,
        providerSubscriptionId: `sub_${userId}`,
        lastEventAt: null,
        ...overrides,
    }
    await Subscription.findOneAndUpdate({ userId }, { $set: doc, $setOnInsert: { userId } }, { upsert: true })
}

export const removeSubscription = async (userId: string): Promise<void> => {
    await Subscription.deleteMany({ userId })
}

export const BILLING_STATES: Record<string, SubscriptionOverrides> = {
    trialing: { status: 'trialing', trialEndsAt: daysFromNow(10), currentPeriodEnd: null },
    active: { status: 'active' },
    past_due_in_grace: { status: 'past_due', pastDueSince: new Date(Date.now() - 1 * DAY_MS) },
    past_due_grace_elapsed: { status: 'past_due', pastDueSince: new Date(Date.now() - 60 * DAY_MS) },
    trial_expired: { status: 'trial_expired', trialEndsAt: daysFromNow(-5), currentPeriodEnd: null },
    trialing_but_lapsed: { status: 'trialing', trialEndsAt: daysFromNow(-1), currentPeriodEnd: null },
    cancelled: { status: 'cancelled', currentPeriodEnd: daysFromNow(-1) },
    cancelling_period_elapsed: { status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: daysFromNow(-1) },
}

export const READ_ONLY_STATES = [
    'trial_expired',
    'trialing_but_lapsed',
    'cancelled',
    'cancelling_period_elapsed',
    'past_due_grace_elapsed',
] as const

export const WRITABLE_STATES = ['trialing', 'active', 'past_due_in_grace'] as const

export const WEBHOOK_PATH = '/api/v1/billing/webhook'
export const WEBHOOK_SECRET = FAKE_WEBHOOK_SECRET
export const SIGNATURE_HEADER = FAKE_SIGNATURE_HEADER

export const signPayload = signFakePayload

export { createFakeBillingProvider, type FakeProviderCalls }

export const installFakeBillingProvider = (): FakeProviderCalls => {
    const { provider, calls } = createFakeBillingProvider()
    setBillingProvider(provider)
    return calls
}

export { resetBillingProvider }

let eventCounter = 0

export type WireEvent = Omit<NormalizedBillingEvent, 'occurredAt' | 'currentPeriodEnd'> & {
    occurredAt: string
    currentPeriodEnd?: string | null
}

export const buildEvent = (overrides: Partial<WireEvent> = {}): WireEvent => {
    eventCounter += 1
    return {
        providerEventId: `evt_${Date.now()}_${eventCounter}`,
        type: 'subscription.updated',
        occurredAt: new Date().toISOString(),
        providerCustomerId: 'cus_test',
        providerSubscriptionId: 'sub_test',
        ...overrides,
    } as WireEvent
}

export const postWebhook = (
    app: Application,
    body: object | string,
    opts: { secret?: string; signature?: string | null } = {}
) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body)
    const req = request(app).post(WEBHOOK_PATH).set('content-type', 'application/json')
    const signature =
        opts.signature === null ? undefined : (opts.signature ?? signPayload(raw, opts.secret))
    if (signature !== undefined) req.set(SIGNATURE_HEADER, signature)
    return req.send(raw)
}

export const getFoodMasterId = async (app: Application, token: string): Promise<string> => {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) throw new Error('Food master category not found')
    return food._id
}

export const createAccountViaApi = async (
    app: Application,
    token: string,
    extra: Record<string, unknown> = {}
): Promise<string> => {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name: 'Checking', type: 'checking', openingBalance: 1000, ...extra })
    if (res.status !== 201) throw new Error(`account seed failed: ${res.status} ${res.body.message}`)
    return res.body.data._id
}

export const createExpenseViaApi = (
    app: Application,
    token: string,
    accountId: string,
    categoryId: string,
    extra: Record<string, unknown> = {}
) =>
    request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title: 'Lunch',
            amount: 12,
            date: '2026-01-15T12:00:00.000Z',
            accountId,
            categoryId,
            ...extra,
        })

/** Direct seeding: bypasses every gate, so a scenario can start from any billing state. */
export const seedWorkspace = async (
    ownerId: string,
    members: Array<{ userId: string; role: 'editor' | 'viewer' }> = [],
    name = 'Shared'
): Promise<string> => {
    const workspace = await Workspace.create({
        name,
        ownerId,
        members: [
            { userId: ownerId, role: 'owner' },
            ...members.map((m) => ({ userId: m.userId, role: m.role })),
        ],
    })
    return workspace._id.toString()
}

export const seedPendingInvite = async (
    workspaceId: string,
    inviterUserId: string,
    inviteeUserId: string,
    role: 'editor' | 'viewer' = 'editor'
): Promise<string> => {
    const invite = await WorkspaceInvite.create({
        workspaceId,
        inviterUserId,
        inviteeUserId,
        role,
        status: 'pending',
    })
    return invite._id.toString()
}

export const randomId = (): string => new Types.ObjectId().toString()
