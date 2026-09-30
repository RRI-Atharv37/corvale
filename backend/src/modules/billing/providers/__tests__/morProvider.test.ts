import crypto from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import {
    createMorProvider,
    morConfigFromEnv,
    signCheckoutUserId,
    type MorConfig,
} from '../morProvider'

const SECRET = 'mor_secret'

// storeId is Lemon-Squeezy-shaped and no longer part of MorConfig (M3f.1); kept here only so the
// createCheckoutSession/listSubscriptions/listInvoices bodies below - not yet rewritten for Paddle
// (M3f.4-M3f.5) - still have a value to read at runtime.
const config = {
    apiKey: 'mor_live_key',
    storeId: '9',
    environment: 'sandbox',
    webhookSecret: SECRET,
    prices: {
        plus: { monthly: '101', annual: '102' },
        pro: { monthly: '201', annual: '202' },
    },
} as unknown as MorConfig

const USER_ID = '64b7f0c2a1b2c3d4e5f60718'
const SIGNED_CUSTOM_DATA = { user_id: USER_ID, user_sig: signCheckoutUserId(SECRET, USER_ID) }

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/vnd.api+json' } })

const stubFetch = (responder: (url: string, init: RequestInit) => Response | Promise<Response>) => {
    const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => responder(String(input), init ?? {}))
    return fn as typeof fn & typeof fetch
}

const OCCURRED_AT = '2026-03-01T10:00:00.000000Z'

const envelope = (eventType: string, data: unknown, overrides: Record<string, unknown> = {}) =>
    Buffer.from(
        JSON.stringify({
            event_id: 'evt_01',
            event_type: eventType,
            occurred_at: OCCURRED_AT,
            notification_id: 'ntf_01',
            data,
            ...overrides,
        })
    )

const subscriptionData = (
    overrides: Record<string, unknown> = {},
    customData: Record<string, unknown> | null = SIGNED_CUSTOM_DATA
) => ({
    id: 'sub_77',
    status: 'active',
    customer_id: 'ctm_55',
    address_id: 'add_1',
    currency_code: 'USD',
    created_at: '2026-03-01T09:00:00.000000Z',
    updated_at: '2026-03-01T10:00:00.000000Z',
    started_at: '2026-03-01T09:00:00.000000Z',
    first_billed_at: '2026-03-01T09:00:00.000000Z',
    next_billed_at: '2026-04-01T00:00:00.000000Z',
    paused_at: null,
    canceled_at: null,
    collection_mode: 'automatic',
    billing_details: { additional_information: 'Ada Lovelace ada@example.com' },
    current_billing_period: { starts_at: '2026-03-01T00:00:00.000000Z', ends_at: '2026-04-01T00:00:00.000000Z' },
    scheduled_change: null,
    management_urls: {
        update_payment_method: 'https://buyer-portal.paddle.com/subscriptions/sub_77/update?token=secret-token',
        cancel: 'https://buyer-portal.paddle.com/subscriptions/sub_77/cancel?token=secret-token',
    },
    items: [{ status: 'active', quantity: 1, recurring: true, trial_dates: null, price: { id: '201', name: 'Pro monthly' } }],
    custom_data: customData,
    ...overrides,
})

const subscriptionBody = (
    eventType: string,
    overrides: Record<string, unknown> = {},
    customData: Record<string, unknown> | null = SIGNED_CUSTOM_DATA,
    envelopeOverrides: Record<string, unknown> = {}
) => envelope(eventType, subscriptionData(overrides, customData), envelopeOverrides)

const transactionBody = (eventType: string, overrides: Record<string, unknown> = {}) =>
    envelope(eventType, {
        id: 'txn_9001',
        status: 'completed',
        customer_id: 'ctm_55',
        subscription_id: 'sub_77',
        origin: 'subscription_recurring',
        currency_code: 'USD',
        billing_period: { starts_at: '2026-04-01T00:00:00.000000Z', ends_at: '2026-05-01T00:00:00.000000Z' },
        custom_data: null,
        billed_at: '2026-04-01T00:00:00.000000Z',
        created_at: '2026-04-01T00:00:00.000000Z',
        payments: [{ payment_method_id: 'paymtd_1', method_details: { type: 'card', card: { last4: '4242', cardholder_name: 'Ada Lovelace' } } }],
        details: { totals: { subtotal: '1000', tax: '200', total: '1200' } },
        ...overrides,
    })

const adjustmentBody = (action: string, overrides: Record<string, unknown> = {}, eventType = 'adjustment.created') =>
    envelope(eventType, {
        id: 'adj_1',
        action,
        type: 'partial',
        status: 'pending_approval',
        transaction_id: 'txn_9001',
        subscription_id: 'sub_77',
        customer_id: 'ctm_55',
        currency_code: 'USD',
        totals: { total: '100', subtotal: '92', tax: '8', fee: '5', earnings: '87' },
        created_at: '2026-04-15T08:48:20.239695Z',
        updated_at: '2026-04-15T08:48:20.239695Z',
        ...overrides,
    })

const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({})) })

describe('morConfigFromEnv', () => {
    const full = {
        MOR_API_KEY: 'k',
        MOR_ENVIRONMENT: 'sandbox',
        MOR_WEBHOOK_SECRET: 's',
        MOR_PRICES: JSON.stringify(config.prices),
    }

    it('reads all four settings', () => {
        expect(morConfigFromEnv(full)).toEqual({
            apiKey: 'k',
            environment: 'sandbox',
            webhookSecret: 's',
            prices: config.prices,
        })
    })

    it('reads a production environment', () => {
        expect(morConfigFromEnv({ ...full, MOR_ENVIRONMENT: 'production' }).environment).toBe('production')
    })

    it.each(['MOR_API_KEY', 'MOR_ENVIRONMENT', 'MOR_WEBHOOK_SECRET', 'MOR_PRICES'])(
        'names %s when it is missing',
        (key) => {
            const env = { ...full, [key]: undefined }

            expect(() => morConfigFromEnv(env)).toThrow(key)
        }
    )

    it('reports every missing setting at once', () => {
        expect(() => morConfigFromEnv({})).toThrow(/MOR_API_KEY.*MOR_ENVIRONMENT/s)
    })

    it('rejects an environment that is neither sandbox nor production', () => {
        expect(() => morConfigFromEnv({ ...full, MOR_ENVIRONMENT: 'staging' })).toThrow('MOR_ENVIRONMENT')
    })

    it('rejects prices that are not valid JSON', () => {
        expect(() => morConfigFromEnv({ ...full, MOR_PRICES: '{nope' })).toThrow('MOR_PRICES')
    })

    it('rejects a price id used for two plans or intervals, which would make the plan ambiguous', () => {
        const clash = JSON.stringify({ plus: { monthly: '101', annual: '101' }, pro: { monthly: '201', annual: '202' } })

        expect(() => morConfigFromEnv({ ...full, MOR_PRICES: clash })).toThrow('MOR_PRICES')
    })

    it('rejects a prices map missing a plan or interval', () => {
        const partial = JSON.stringify({ plus: { monthly: '101' }, pro: { monthly: '201', annual: '202' } })

        expect(() => morConfigFromEnv({ ...full, MOR_PRICES: partial })).toThrow('MOR_PRICES')
    })

    it('accepts a flat plan_interval map', () => {
        const flat = JSON.stringify({
            plus_monthly: '101',
            plus_annual: '102',
            pro_monthly: '201',
            pro_annual: '202',
        })

        expect(morConfigFromEnv({ ...full, MOR_PRICES: flat }).prices).toEqual(config.prices)
    })

    it('accepts numeric price ids', () => {
        const numeric = JSON.stringify({
            plus: { monthly: 101, annual: 102 },
            pro: { monthly: 201, annual: 202 },
        })

        expect(morConfigFromEnv({ ...full, MOR_PRICES: numeric }).prices).toEqual(config.prices)
    })
})

describe('verifyWebhook', () => {
    const NOW = new Date('2026-09-29T12:00:00.000Z')
    const nowSeconds = Math.floor(NOW.getTime() / 1000)
    const raw = subscriptionBody('subscription_created')

    const h1Of = (body: Buffer, ts: number | string, secret = SECRET): string =>
        crypto.createHmac('sha256', secret).update(`${ts}:`).update(body).digest('hex')
    const header = (ts: number | string, h1: string): string => `ts=${ts};h1=${h1}`

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(NOW)
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('is HMAC-SHA256 over "<ts>:<raw body>", hex, in Paddle-Signature', () => {
        const headers = { 'paddle-signature': header(nowSeconds, h1Of(raw, nowSeconds)) }

        expect(provider.verifyWebhook(raw, headers)).toBe(true)
    })

    it('does not honour a signature made with another secret', () => {
        const headers = { 'paddle-signature': header(nowSeconds, h1Of(raw, nowSeconds, 'someone_elses_secret')) }

        expect(provider.verifyWebhook(raw, headers)).toBe(false)
    })

    it('does not honour a signature over the body alone, without the timestamp', () => {
        const bare = crypto.createHmac('sha256', SECRET).update(raw).digest('hex')

        expect(provider.verifyWebhook(raw, { 'paddle-signature': header(nowSeconds, bare) })).toBe(false)
    })

    it('does not honour a timestamp that was altered after signing', () => {
        const h1 = h1Of(raw, nowSeconds - 3)

        expect(provider.verifyWebhook(raw, { 'paddle-signature': header(nowSeconds, h1) })).toBe(false)
    })

    it('does not honour a body altered after signing', () => {
        const headers = { 'paddle-signature': header(nowSeconds, h1Of(raw, nowSeconds)) }

        expect(provider.verifyWebhook(Buffer.from(raw.toString('utf8').replace('77', '78')), headers)).toBe(false)
    })

    it('does not read the signature from any header other than Paddle-Signature', () => {
        const value = header(nowSeconds, h1Of(raw, nowSeconds))

        expect(provider.verifyWebhook(raw, { 'x-signature': value })).toBe(false)
        expect(provider.verifyWebhook(raw, { 'x-hub-signature-256': value })).toBe(false)
    })

    it('accepts a timestamp exactly at the tolerance and rejects one just past it, in either direction', () => {
        const verify = (ts: number) => provider.verifyWebhook(raw, { 'paddle-signature': header(ts, h1Of(raw, ts)) })

        expect(verify(nowSeconds - 5)).toBe(true)
        expect(verify(nowSeconds + 5)).toBe(true)
        expect(verify(nowSeconds - 6)).toBe(false)
        expect(verify(nowSeconds + 6)).toBe(false)
    })

    it('rejects a stale but otherwise valid delivery (replay)', () => {
        const stale = nowSeconds - 3600

        expect(provider.verifyWebhook(raw, { 'paddle-signature': header(stale, h1Of(raw, stale)) })).toBe(false)
    })

    it('accepts any one valid h1 when the header carries several (secret rotation)', () => {
        const value = `ts=${nowSeconds};h1=${h1Of(raw, nowSeconds, 'retired_secret')};h1=${h1Of(raw, nowSeconds)}`

        expect(provider.verifyWebhook(raw, { 'paddle-signature': value })).toBe(true)
    })

    it.each([
        ['an empty header', ''],
        ['no ts', 'h1=abcd'],
        ['no h1', `ts=${1}`],
        ['a non-numeric ts', 'ts=yesterday;h1=abcd'],
        ['a fractional ts', 'ts=1.5;h1=abcd'],
        ['a signed ts', 'ts=-1;h1=abcd'],
        ['a repeated ts', `ts=${1};ts=${2};h1=abcd`],
        ['a non-hex h1', `ts=${1};h1=not-hex`],
        ['garbage', 'not a signature header'],
    ])('rejects %s without throwing', (_label, value) => {
        expect(() => provider.verifyWebhook(raw, { 'paddle-signature': value })).not.toThrow()
        expect(provider.verifyWebhook(raw, { 'paddle-signature': value })).toBe(false)
    })

    it('rejects a missing, undefined or repeated (array) header and an empty body', () => {
        const value = header(nowSeconds, h1Of(raw, nowSeconds))

        expect(provider.verifyWebhook(raw, {})).toBe(false)
        expect(provider.verifyWebhook(raw, { 'paddle-signature': undefined })).toBe(false)
        expect(provider.verifyWebhook(raw, { 'paddle-signature': [value, value] })).toBe(false)
        expect(provider.verifyWebhook(Buffer.alloc(0), { 'paddle-signature': header(nowSeconds, h1Of(Buffer.alloc(0), nowSeconds)) })).toBe(false)
    })
})

describe('parseEvent - subscription events', () => {
    it.each([
        ['subscription.created', 'subscription.created'],
        ['subscription.updated', 'subscription.updated'],
        ['subscription.activated', 'subscription.updated'],
        ['subscription.trialing', 'subscription.updated'],
        ['subscription.past_due', 'subscription.updated'],
        ['subscription.paused', 'subscription.updated'],
        ['subscription.resumed', 'subscription.updated'],
        ['subscription.canceled', 'subscription.deleted'],
    ])('maps %s to %s', (providerType, expected) => {
        const overrides = providerType === 'subscription.canceled' ? { status: 'canceled', canceled_at: '2026-03-01T10:00:00Z' } : {}

        expect(provider.parseEvent(subscriptionBody(providerType, overrides)).type).toBe(expected)
    })

    it('reads ids, user, plan, interval and period from the subscription resource', () => {
        const event = provider.parseEvent(subscriptionBody('subscription.created'))

        expect(event).toMatchObject({
            type: 'subscription.created',
            userId: USER_ID,
            providerCustomerId: 'ctm_55',
            providerSubscriptionId: 'sub_77',
            planCode: 'pro',
            interval: 'monthly',
            status: 'active',
            cancelAtPeriodEnd: false,
        })
        expect(event.currentPeriodEnd).toEqual(new Date('2026-04-01T00:00:00.000Z'))
        expect(event.occurredAt).toEqual(new Date('2026-03-01T10:00:00.000Z'))
    })

    it.each([
        ['101', 'plus', 'monthly'],
        ['102', 'plus', 'annual'],
        ['201', 'pro', 'monthly'],
        ['202', 'pro', 'annual'],
    ])('resolves price %s to plan %s and interval %s', (priceId, plan, interval) => {
        const items = [{ status: 'active', quantity: 1, trial_dates: null, price: { id: priceId } }]
        const event = provider.parseEvent(subscriptionBody('subscription.updated', { items }))

        expect(event.planCode).toBe(plan)
        expect(event.interval).toBe(interval)
    })

    it('leaves planCode undefined for a price it does not know', () => {
        const items = [{ status: 'active', quantity: 1, trial_dates: null, price: { id: 'pri_unknown' } }]
        const event = provider.parseEvent(subscriptionBody('subscription.updated', { items }))

        expect(event.planCode).toBeUndefined()
    })

    it('takes the plan from the first item whose price it knows', () => {
        const items = [
            { status: 'active', quantity: 1, trial_dates: null, price: { id: 'pri_addon' } },
            { status: 'active', quantity: 1, trial_dates: null, price: { id: '102' } },
        ]

        expect(provider.parseEvent(subscriptionBody('subscription.updated', { items })).planCode).toBe('plus')
    })

    it('maps trialing to trialing and carries the trial end from the item', () => {
        const items = [
            { status: 'trialing', quantity: 1, price: { id: '201' }, trial_dates: { starts_at: '2026-03-01T00:00:00Z', ends_at: '2026-03-15T00:00:00.000000Z' } },
        ]
        const event = provider.parseEvent(subscriptionBody('subscription.trialing', { status: 'trialing', items }))

        expect(event.status).toBe('trialing')
        expect(event.trialEndsAt).toEqual(new Date('2026-03-15T00:00:00.000Z'))
    })

    it('leaves trialEndsAt undefined when no item is on a trial', () => {
        expect(provider.parseEvent(subscriptionBody('subscription.updated')).trialEndsAt).toBeUndefined()
    })

    it('maps past_due to past_due', () => {
        expect(provider.parseEvent(subscriptionBody('subscription.past_due', { status: 'past_due' })).status).toBe('past_due')
    })

    it('leaves status undefined for paused, which has no equivalent local state', () => {
        const event = provider.parseEvent(subscriptionBody('subscription.paused', { status: 'paused', paused_at: '2026-03-01T10:00:00Z' }))

        expect(event.status).toBeUndefined()
    })

    it('leaves status undefined for a status it does not know', () => {
        expect(provider.parseEvent(subscriptionBody('subscription.updated', { status: 'brand_new' })).status).toBeUndefined()
    })

    it('reads a scheduled cancel as active until the effective date, flagged to cancel', () => {
        const event = provider.parseEvent(
            subscriptionBody('subscription.updated', {
                scheduled_change: { action: 'cancel', effective_at: '2026-05-01T00:00:00.000000Z', resume_at: null },
            })
        )

        expect(event.status).toBe('active')
        expect(event.cancelAtPeriodEnd).toBe(true)
        expect(event.currentPeriodEnd).toEqual(new Date('2026-05-01T00:00:00.000Z'))
    })

    it('does not treat a scheduled pause as a cancel', () => {
        const event = provider.parseEvent(
            subscriptionBody('subscription.updated', {
                scheduled_change: { action: 'pause', effective_at: '2026-05-01T00:00:00.000000Z', resume_at: null },
            })
        )

        expect(event.cancelAtPeriodEnd).toBe(false)
        expect(event.currentPeriodEnd).toEqual(new Date('2026-04-01T00:00:00.000Z'))
    })

    it('falls back to next_billed_at when the resource has no billing period', () => {
        const event = provider.parseEvent(subscriptionBody('subscription.updated', { current_billing_period: null }))

        expect(event.currentPeriodEnd).toEqual(new Date('2026-04-01T00:00:00.000Z'))
    })

    it('treats a canceled subscription as cancelled whatever else it says', () => {
        const event = provider.parseEvent(subscriptionBody('subscription.canceled', { status: 'canceled', canceled_at: '2026-03-01T10:00:00Z' }))

        expect(event.type).toBe('subscription.deleted')
        expect(event.status).toBe('cancelled')
        expect(event.cancelAtPeriodEnd).toBe(false)
    })

    it('leaves userId undefined when the checkout carried no custom data', () => {
        const event = provider.parseEvent(subscriptionBody('subscription.updated', {}, null))

        expect(event.userId).toBeUndefined()
    })

    it('ignores a non-string user_id in custom data', () => {
        const event = provider.parseEvent(subscriptionBody('subscription.created', {}, { user_id: { $ne: null } }))

        expect(event.userId).toBeUndefined()
    })

    describe('checkout linkage signature (SEC-72)', () => {
        const VICTIM_ID = '64b7f0c2a1b2c3d4e5f60999'

        it('ignores a user_id that carries no signature, as a buyer-supplied customData would', () => {
            const event = provider.parseEvent(subscriptionBody('subscription.created', {}, { user_id: VICTIM_ID }))

            expect(event.userId).toBeUndefined()
            expect(event.providerSubscriptionId).toBe('sub_77')
        })

        it('ignores a user_id paired with the signature issued for a different user', () => {
            const event = provider.parseEvent(
                subscriptionBody('subscription.created', {}, { user_id: VICTIM_ID, user_sig: signCheckoutUserId(SECRET, USER_ID) })
            )

            expect(event.userId).toBeUndefined()
        })

        it('ignores a signature made with another secret', () => {
            const event = provider.parseEvent(
                subscriptionBody('subscription.created', {}, { user_id: VICTIM_ID, user_sig: signCheckoutUserId('someone_elses_secret', VICTIM_ID) })
            )

            expect(event.userId).toBeUndefined()
        })

        it('ignores a signature that is not hex, the wrong length or not a string', () => {
            for (const user_sig of ['zz', 'ab', '', 42, null, { $ne: null }]) {
                expect(provider.parseEvent(subscriptionBody('subscription.created', {}, { user_id: USER_ID, user_sig })).userId).toBeUndefined()
            }
        })

        it('does not accept the raw webhook secret as a signing key for the user id', () => {
            const naive = crypto.createHmac('sha256', SECRET).update(USER_ID).digest('hex')

            expect(provider.parseEvent(subscriptionBody('subscription.created', {}, { user_id: USER_ID, user_sig: naive })).userId).toBeUndefined()
        })

        it('links the user id the server signed', () => {
            expect(provider.parseEvent(subscriptionBody('subscription.created')).userId).toBe(USER_ID)
        })
    })
})

describe('parseEvent - payment, refund and unknown events', () => {
    it('maps a completed transaction to payment.succeeded, linked by subscription_id', () => {
        const event = provider.parseEvent(transactionBody('transaction.completed'))

        expect(event).toMatchObject({
            type: 'payment.succeeded',
            providerCustomerId: 'ctm_55',
            providerSubscriptionId: 'sub_77',
        })
        expect(event.occurredAt).toEqual(new Date('2026-03-01T10:00:00.000Z'))
    })

    it('does not map transaction.paid, which can arrive before the subscription link exists', () => {
        const event = provider.parseEvent(transactionBody('transaction.paid', { status: 'paid', subscription_id: null }))

        expect(event.type).toBe('transaction.paid')
    })

    it('maps a failed transaction payment to payment.failed', () => {
        const event = provider.parseEvent(transactionBody('transaction.payment_failed', { status: 'past_due' }))

        expect(event).toMatchObject({ type: 'payment.failed', providerSubscriptionId: 'sub_77', providerCustomerId: 'ctm_55' })
    })

    it.each(['refund', 'credit'])('maps an approved %s adjustment to refund.issued', (action) => {
        const event = provider.parseEvent(adjustmentBody(action, { status: 'approved' }))

        expect(event).toMatchObject({ type: 'refund.issued', providerSubscriptionId: 'sub_77', providerCustomerId: 'ctm_55' })
    })

    it('counts a refund when adjustment.updated approves it, not when it is first created pending approval', () => {
        const created = provider.parseEvent(adjustmentBody('refund'))
        const approved = provider.parseEvent(adjustmentBody('refund', { status: 'approved' }, 'adjustment.updated'))

        expect(created.type).toBe('adjustment.created')
        expect(approved).toMatchObject({ type: 'refund.issued', providerSubscriptionId: 'sub_77', providerCustomerId: 'ctm_55' })
        expect(approved.payload).toMatchObject({ total: 100, currency: 'USD' })
    })

    it.each([
        ['adjustment.created', 'pending_approval'],
        ['adjustment.created', 'rejected'],
        ['adjustment.updated', 'pending_approval'],
        ['adjustment.updated', 'rejected'],
        ['adjustment.updated', 'reversed'],
    ])('passes a refund on %s with status %s through unmapped, so it is never counted', (eventType, status) => {
        const event = provider.parseEvent(adjustmentBody('refund', { status }, eventType))

        expect(event.type).toBe(eventType)
        expect(event.userId).toBeUndefined()
    })

    it('passes a refund adjustment with no status through unmapped', () => {
        const event = provider.parseEvent(adjustmentBody('refund', { status: undefined }))

        expect(event.type).toBe('adjustment.created')
    })

    it('maps a chargeback adjustment to dispute.opened, since Paddle has no separate dispute event', () => {
        const event = provider.parseEvent(adjustmentBody('chargeback', { status: 'approved', type: 'full' }))

        expect(event).toMatchObject({ type: 'dispute.opened', providerSubscriptionId: 'sub_77', providerCustomerId: 'ctm_55' })
    })

    it('opens a dispute once, on creation: a later adjustment.updated for the chargeback is not a second dispute', () => {
        const event = provider.parseEvent(adjustmentBody('chargeback', { status: 'approved' }, 'adjustment.updated'))

        expect(event.type).toBe('adjustment.updated')
    })

    it.each(['chargeback_warning', 'chargeback_reverse', 'chargeback_warning_reverse', 'credit_reverse', 'something_new'])(
        'passes an approved %s adjustment through unmapped, so it cannot revoke access or count as a refund',
        (action) => {
            for (const eventType of ['adjustment.created', 'adjustment.updated']) {
                const event = provider.parseEvent(adjustmentBody(action, { status: 'approved' }, eventType))

                expect(event.type).toBe(eventType)
                expect(event.userId).toBeUndefined()
                expect(event.status).toBeUndefined()
            }
        }
    )

    it('carries no period end on payment events (the paired subscription.updated does)', () => {
        expect(provider.parseEvent(transactionBody('transaction.completed')).currentPeriodEnd).toBeUndefined()
    })

    it('passes an unmapped provider event type through as its own type', () => {
        const event = provider.parseEvent(envelope('customer.updated', { id: 'ctm_55' }))

        expect(event.type).toBe('customer.updated')
    })

    it('never emits a plan or status for an event type it does not map', () => {
        const event = provider.parseEvent(subscriptionBody('subscription.imported'))

        expect(event.type).toBe('subscription.imported')
        expect(event.planCode).toBeUndefined()
        expect(event.status).toBeUndefined()
        expect(event.userId).toBeUndefined()
    })

    it('accepts an unmapped event with an unparseable timestamp rather than failing the delivery', () => {
        const event = provider.parseEvent(envelope('customer.updated', { id: 'ctm_55' }, { occurred_at: 'whenever' }))

        expect(event.occurredAt).toBeInstanceOf(Date)
    })
})

describe('parseEvent - event id and stored payload', () => {
    it('uses the provider event_id as providerEventId', () => {
        expect(provider.parseEvent(subscriptionBody('subscription.updated')).providerEventId).toBe('evt_01')
    })

    it('keeps the id across a redelivery whose bytes differ', () => {
        const a = provider.parseEvent(subscriptionBody('subscription.updated', {}, null, { notification_id: 'ntf_01' }))
        const b = provider.parseEvent(subscriptionBody('subscription.updated', {}, null, { notification_id: 'ntf_02' }))

        expect(b.providerEventId).toBe(a.providerEventId)
    })

    it('gives distinct events distinct ids', () => {
        const a = provider.parseEvent(subscriptionBody('subscription.updated'))
        const b = provider.parseEvent(subscriptionBody('subscription.updated', {}, null, { event_id: 'evt_02' }))

        expect(b.providerEventId).not.toBe(a.providerEventId)
    })

    it('stores a minimised payload with no email, name, card or portal token (billing ledger outlives erasure)', () => {
        const stored = [
            provider.parseEvent(subscriptionBody('subscription.created')),
            provider.parseEvent(transactionBody('transaction.completed')),
        ]
            .map((event) => JSON.stringify(event.payload))
            .join()

        for (const banned of ['ada@example.com', 'Ada', 'Lovelace', '4242', 'secret-token', 'buyer-portal']) {
            expect(stored).not.toContain(banned)
        }
    })

    it('keeps the fields needed to audit a subscription event', () => {
        const payload = provider.parseEvent(subscriptionBody('subscription.created')).payload as Record<string, unknown>

        expect(payload).toMatchObject({
            providerEventName: 'subscription.created',
            providerStatus: 'active',
            priceId: '201',
            providerCustomerId: 'ctm_55',
            providerSubscriptionId: 'sub_77',
        })
    })

    it('keeps a scheduled change action for audit', () => {
        const payload = provider.parseEvent(
            subscriptionBody('subscription.updated', { scheduled_change: { action: 'cancel', effective_at: '2026-05-01T00:00:00Z', resume_at: null } })
        ).payload as Record<string, unknown>

        expect(payload.scheduledChangeAction).toBe('cancel')
    })

    it('keeps amount, currency and origin for a transaction event, as a number of minor units', () => {
        const payload = provider.parseEvent(transactionBody('transaction.completed')).payload as Record<string, unknown>

        expect(payload).toMatchObject({
            providerEventName: 'transaction.completed',
            providerStatus: 'completed',
            origin: 'subscription_recurring',
            total: 1200,
            currency: 'USD',
        })
    })

    it('keeps amount, currency, action and status for an adjustment, as a number of minor units', () => {
        const payload = provider.parseEvent(adjustmentBody('refund')).payload as Record<string, unknown>

        expect(payload).toMatchObject({
            providerEventName: 'adjustment.created',
            adjustmentAction: 'refund',
            providerStatus: 'pending_approval',
            total: 100,
            currency: 'USD',
        })
    })

    it.each([['not-a-number'], ['12.5'], ['-5'], [null], [{ $gt: 0 }]])('drops an amount of %j rather than guessing', (total) => {
        const payload = provider.parseEvent(adjustmentBody('refund', { totals: { total } })).payload as Record<string, unknown>

        expect(payload.total).toBeUndefined()
    })

    it('stores a minimised payload even for an event type it does not map', () => {
        const stored = JSON.stringify(provider.parseEvent(subscriptionBody('subscription.imported')).payload)

        for (const banned of ['ada@example.com', 'Lovelace', 'secret-token']) {
            expect(stored).not.toContain(banned)
        }
        expect(stored).toContain('subscription.imported')
    })
})

describe('parseEvent - malformed input', () => {
    it.each([
        ['no event_id', { event_type: 'subscription.created', occurred_at: OCCURRED_AT, data: { id: 'sub_77' } }],
        ['an empty event_id', { event_id: '', event_type: 'subscription.created', occurred_at: OCCURRED_AT, data: { id: 'sub_77' } }],
        ['a non-string event_id', { event_id: 7, event_type: 'subscription.created', occurred_at: OCCURRED_AT, data: { id: 'sub_77' } }],
        ['no event_type', { event_id: 'evt_01', occurred_at: OCCURRED_AT, data: { id: 'sub_77' } }],
        ['a non-string event_type', { event_id: 'evt_01', event_type: 7, occurred_at: OCCURRED_AT, data: { id: 'sub_77' } }],
        ['no data', { event_id: 'evt_01', event_type: 'subscription.created', occurred_at: OCCURRED_AT }],
        ['array data', { event_id: 'evt_01', event_type: 'subscription.created', occurred_at: OCCURRED_AT, data: [] }],
    ])('rejects a payload with %s', (_label, body) => {
        expect(() => provider.parseEvent(Buffer.from(JSON.stringify(body)))).toThrow(CustomError)
    })

    it('rejects a body that is not JSON', () => {
        expect(() => provider.parseEvent(Buffer.from('not json'))).toThrow(ERROR_MESSAGES.BILLING.WEBHOOK_PAYLOAD_INVALID)
    })

    it.each([
        ['an unparseable', { occurred_at: 'yesterday-ish' }],
        ['a missing', { occurred_at: undefined }],
    ])('rejects a mapped event with %s timestamp', (_label, overrides) => {
        expect(() => provider.parseEvent(subscriptionBody('subscription.updated', {}, null, overrides))).toThrow(
            ERROR_MESSAGES.BILLING.WEBHOOK_PAYLOAD_INVALID
        )
    })
})

const paddleJson = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('createCheckoutSession', () => {
    const PAYMENT_LINK = 'https://app.corvale.test/pay?_ptxn=txn_01'
    const checkoutResponse = () =>
        paddleJson({ data: { id: 'txn_01', status: 'ready', checkout: { url: PAYMENT_LINK } }, meta: { request_id: 'r1' } }, 201)
    const input = { userId: USER_ID, email: 'a@b.co', planCode: 'plus', interval: 'monthly' } as const

    it('POSTs a transaction for the plan/interval price, tagged with our user id, and returns its payment link', async () => {
        const fetchImpl = stubFetch(checkoutResponse)
        const p = createMorProvider(config, { fetchImpl })

        const session = await p.createCheckoutSession({ ...input, planCode: 'pro', interval: 'annual' })

        expect(session.url).toBe(PAYMENT_LINK)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('https://sandbox-api.paddle.com/transactions')
        expect(init.method).toBe('POST')
        const headers = init.headers as Record<string, string>
        expect(headers.Authorization).toBe('Bearer mor_live_key')
        expect(headers.Accept).toBe('application/json')
        expect(headers['Content-Type']).toBe('application/json')
        expect(JSON.parse(String(init.body))).toEqual({
            items: [{ price_id: '202', quantity: 1 }],
            custom_data: { user_id: USER_ID, user_sig: signCheckoutUserId(SECRET, USER_ID) },
        })
    })

    it('uses the production API host in the production environment', async () => {
        const fetchImpl = stubFetch(checkoutResponse)
        const p = createMorProvider({ ...config, environment: 'production' }, { fetchImpl })

        await p.createCheckoutSession(input)

        expect((fetchImpl.mock.calls[0] as [string, RequestInit])[0]).toBe('https://api.paddle.com/transactions')
    })

    it.each([
        ['plus', 'monthly', '101'],
        ['plus', 'annual', '102'],
        ['pro', 'monthly', '201'],
        ['pro', 'annual', '202'],
    ] as const)('uses price %s %s -> %s', async (planCode, interval, priceId) => {
        const fetchImpl = stubFetch(checkoutResponse)
        const p = createMorProvider(config, { fetchImpl })

        await p.createCheckoutSession({ ...input, planCode, interval })

        const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body))
        expect(body.items).toEqual([{ price_id: priceId, quantity: 1 }])
    })

    it('does not send the email to the provider, which collects it at checkout', async () => {
        const fetchImpl = stubFetch(checkoutResponse)
        const p = createMorProvider(config, { fetchImpl })

        await p.createCheckoutSession({ ...input, email: 'ada@example.com' })

        expect(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body)).not.toContain('ada@example.com')
    })

    it('is a 502 with the generic message when the provider answers non-2xx, leaking neither key nor body', async () => {
        const fetchImpl = stubFetch(() => paddleJson({ error: { detail: 'secret upstream detail mor_live_key' } }, 422))
        const p = createMorProvider(config, { fetchImpl })

        let thrown: unknown
        try {
            await p.createCheckoutSession(input)
        } catch (error) {
            thrown = error
        }

        expect(thrown).toBeInstanceOf(CustomError)
        expect((thrown as CustomError).statusCode).toBe(502)
        expect((thrown as CustomError).message).toBe(ERROR_MESSAGES.BILLING.PROVIDER_REQUEST_FAILED)
    })

    it('is a 502 when the network call itself fails', async () => {
        const fetchImpl = stubFetch(() => {
            throw new TypeError('fetch failed')
        })
        const p = createMorProvider(config, { fetchImpl })

        await expect(p.createCheckoutSession(input)).rejects.toMatchObject({
            statusCode: 502,
            message: ERROR_MESSAGES.BILLING.PROVIDER_REQUEST_FAILED,
        })
    })

    it.each([
        ['no checkout object', { data: { id: 'txn_01' } }],
        ['a null checkout url (no default payment link configured)', { data: { id: 'txn_01', checkout: { url: null } } }],
        ['an empty checkout url', { data: { id: 'txn_01', checkout: { url: '' } } }],
        ['no data', {}],
    ])('is a 502 when the response carries %s', async (_label, body) => {
        const p = createMorProvider(config, { fetchImpl: stubFetch(() => paddleJson(body)) })

        await expect(p.createCheckoutSession(input)).rejects.toMatchObject({ statusCode: 502 })
    })

    it.each(['javascript:alert(1)', 'http://app.corvale.test/pay?_ptxn=txn_01', 'not a url'])(
        'refuses to hand back the non-https payment link %s',
        async (url) => {
            const p = createMorProvider(config, { fetchImpl: stubFetch(() => paddleJson({ data: { checkout: { url } } })) })

            await expect(p.createCheckoutSession(input)).rejects.toMatchObject({ statusCode: 502 })
        }
    )

    it('sends a timeout signal so a hung provider cannot hang the request', async () => {
        const fetchImpl = stubFetch(checkoutResponse)
        const p = createMorProvider(config, { fetchImpl })

        await p.createCheckoutSession(input)

        expect((fetchImpl.mock.calls[0] as [string, RequestInit])[1].signal).toBeInstanceOf(AbortSignal)
    })
})

describe('getPortalUrl', () => {
    const OVERVIEW = 'https://customer-portal.paddle.com/cpl_01?action=overview&token=pga_secret'
    const portalResponse = () =>
        paddleJson({
            data: {
                id: 'cpls_01',
                customer_id: 'ctm_55',
                urls: { general: { overview: OVERVIEW }, subscriptions: [] },
                created_at: '2026-09-29T10:00:00Z',
            },
        })

    it('creates a portal session for the customer and returns its overview url', async () => {
        const fetchImpl = stubFetch(portalResponse)
        const p = createMorProvider(config, { fetchImpl })

        const portal = await p.getPortalUrl({ providerCustomerId: 'ctm_55' })

        expect(portal.url).toBe(OVERVIEW)
        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('https://sandbox-api.paddle.com/customers/ctm_55/portal-sessions')
        expect(init.method).toBe('POST')
        const headers = init.headers as Record<string, string>
        expect(headers.Authorization).toBe('Bearer mor_live_key')
        expect(headers['Content-Type']).toBe('application/json')
        expect(JSON.parse(String(init.body))).toEqual({})
    })

    it('url-encodes the customer id so it cannot rewrite the request path', async () => {
        const fetchImpl = stubFetch(portalResponse)
        const p = createMorProvider(config, { fetchImpl })

        await p.getPortalUrl({ providerCustomerId: 'ctm_55/../../subscriptions/1' })

        expect((fetchImpl.mock.calls[0] as [string, RequestInit])[0]).toBe(
            'https://sandbox-api.paddle.com/customers/ctm_55%2F..%2F..%2Fsubscriptions%2F1/portal-sessions'
        )
    })

    it.each([
        ['no overview url', { data: { urls: { general: {} } } }],
        ['no urls', { data: {} }],
        ['a non-https overview url', { data: { urls: { general: { overview: 'http://customer-portal.paddle.com/x' } } } }],
        ['a javascript overview url', { data: { urls: { general: { overview: 'javascript:alert(1)' } } } }],
    ])('is a 502 when the session has %s', async (_label, body) => {
        const p = createMorProvider(config, { fetchImpl: stubFetch(() => paddleJson(body)) })

        await expect(p.getPortalUrl({ providerCustomerId: 'ctm_55' })).rejects.toMatchObject({
            statusCode: 502,
            message: ERROR_MESSAGES.BILLING.PROVIDER_REQUEST_FAILED,
        })
    })

    it('is a 502 on a non-2xx answer, without leaking the provider body', async () => {
        const p = createMorProvider(config, { fetchImpl: stubFetch(() => paddleJson({ error: { detail: 'pga_secret' } }, 404)) })

        await expect(p.getPortalUrl({ providerCustomerId: 'ctm_55' })).rejects.toMatchObject({
            statusCode: 502,
            message: ERROR_MESSAGES.BILLING.PROVIDER_REQUEST_FAILED,
        })
    })
})
