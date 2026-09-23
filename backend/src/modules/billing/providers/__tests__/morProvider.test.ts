import crypto from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import {
    createMorProvider,
    morConfigFromEnv,
    type MorConfig,
} from '../morProvider'

const SECRET = 'mor_secret'

const config: MorConfig = {
    apiKey: 'mor_live_key',
    storeId: '9',
    webhookSecret: SECRET,
    variants: {
        plus: { monthly: '101', annual: '102' },
        pro: { monthly: '201', annual: '202' },
    },
}

const USER_ID = '64b7f0c2a1b2c3d4e5f60718'

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/vnd.api+json' } })

const stubFetch = (responder: (url: string, init: RequestInit) => Response | Promise<Response>) => {
    const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => responder(String(input), init ?? {}))
    return fn as typeof fn & typeof fetch
}

const subscriptionAttributes = (overrides: Record<string, unknown> = {}) => ({
    store_id: 9,
    customer_id: 55,
    order_id: 300,
    product_id: 40,
    variant_id: 201,
    status: 'active',
    cancelled: false,
    user_name: 'Ada Lovelace',
    user_email: 'ada@example.com',
    trial_ends_at: null,
    renews_at: '2026-04-01T00:00:00.000000Z',
    ends_at: null,
    urls: { customer_portal: 'https://store.example.test/billing?expires=1&signature=s' },
    created_at: '2026-03-01T09:00:00.000000Z',
    updated_at: '2026-03-01T10:00:00.000000Z',
    ...overrides,
})

const subscriptionBody = (
    eventName: string,
    attributes: Record<string, unknown> = {},
    custom: Record<string, unknown> | undefined = { user_id: USER_ID }
) =>
    Buffer.from(
        JSON.stringify({
            meta: { event_name: eventName, webhook_id: 'wh_1', ...(custom ? { custom_data: custom } : {}) },
            data: { type: 'subscriptions', id: '77', attributes: subscriptionAttributes(attributes) },
        })
    )

const invoiceBody = (eventName: string, attributes: Record<string, unknown> = {}) =>
    Buffer.from(
        JSON.stringify({
            meta: { event_name: eventName, webhook_id: 'wh_1' },
            data: {
                type: 'subscription-invoices',
                id: '9001',
                attributes: {
                    store_id: 9,
                    customer_id: 55,
                    subscription_id: 77,
                    billing_reason: 'renewal',
                    status: 'paid',
                    total: 1200,
                    currency: 'USD',
                    refunded: false,
                    user_email: 'ada@example.com',
                    user_name: 'Ada Lovelace',
                    created_at: '2026-04-01T00:00:00.000000Z',
                    updated_at: '2026-04-01T00:00:05.000000Z',
                    ...attributes,
                },
            },
        })
    )

const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({})) })

describe('morConfigFromEnv', () => {
    const full = {
        MOR_API_KEY: 'k',
        MOR_STORE_ID: '9',
        MOR_WEBHOOK_SECRET: 's',
        MOR_VARIANTS: JSON.stringify(config.variants),
    }

    it('reads all four settings', () => {
        expect(morConfigFromEnv(full)).toEqual({
            apiKey: 'k',
            storeId: '9',
            webhookSecret: 's',
            variants: config.variants,
        })
    })

    it.each(['MOR_API_KEY', 'MOR_STORE_ID', 'MOR_WEBHOOK_SECRET', 'MOR_VARIANTS'])(
        'names %s when it is missing',
        (key) => {
            const env = { ...full, [key]: undefined }

            expect(() => morConfigFromEnv(env)).toThrow(key)
        }
    )

    it('reports every missing setting at once', () => {
        expect(() => morConfigFromEnv({})).toThrow(/MOR_API_KEY.*MOR_STORE_ID/s)
    })

    it('rejects variants that are not valid JSON', () => {
        expect(() => morConfigFromEnv({ ...full, MOR_VARIANTS: '{nope' })).toThrow('MOR_VARIANTS')
    })

    it('rejects a variant id used for two plans or intervals, which would make the plan ambiguous', () => {
        const clash = JSON.stringify({ plus: { monthly: '101', annual: '101' }, pro: { monthly: '201', annual: '202' } })

        expect(() => morConfigFromEnv({ ...full, MOR_VARIANTS: clash })).toThrow('MOR_VARIANTS')
    })

    it('rejects a variants map missing a plan or interval', () => {
        const partial = JSON.stringify({ plus: { monthly: '101' }, pro: { monthly: '201', annual: '202' } })

        expect(() => morConfigFromEnv({ ...full, MOR_VARIANTS: partial })).toThrow('MOR_VARIANTS')
    })

    it('accepts a flat plan_interval map', () => {
        const flat = JSON.stringify({
            plus_monthly: '101',
            plus_annual: '102',
            pro_monthly: '201',
            pro_annual: '202',
        })

        expect(morConfigFromEnv({ ...full, MOR_VARIANTS: flat }).variants).toEqual(config.variants)
    })

    it('accepts numeric variant ids', () => {
        const numeric = JSON.stringify({
            plus: { monthly: 101, annual: 102 },
            pro: { monthly: 201, annual: 202 },
        })

        expect(morConfigFromEnv({ ...full, MOR_VARIANTS: numeric }).variants).toEqual(config.variants)
    })
})

describe('verifyWebhook', () => {
    it('is HMAC-SHA256 over the raw bytes, hex, in x-signature', () => {
        const raw = subscriptionBody('subscription_created')
        const signature = crypto.createHmac('sha256', SECRET).update(raw).digest('hex')

        expect(provider.verifyWebhook(raw, { 'x-signature': signature })).toBe(true)
    })

    it('does not honour a signature made with another secret', () => {
        const raw = subscriptionBody('subscription_created')
        const signature = crypto.createHmac('sha256', 'someone_elses_secret').update(raw).digest('hex')

        expect(provider.verifyWebhook(raw, { 'x-signature': signature })).toBe(false)
    })

    it('does not read the signature from any header other than x-signature', () => {
        const raw = subscriptionBody('subscription_created')
        const signature = crypto.createHmac('sha256', SECRET).update(raw).digest('hex')

        expect(provider.verifyWebhook(raw, { 'x-hub-signature-256': signature })).toBe(false)
    })
})

describe('parseEvent - subscription events', () => {
    it.each([
        ['subscription_created', 'subscription.created'],
        ['subscription_updated', 'subscription.updated'],
        ['subscription_resumed', 'subscription.updated'],
        ['subscription_unpaused', 'subscription.updated'],
        ['subscription_paused', 'subscription.updated'],
        ['subscription_cancelled', 'subscription.updated'],
        ['subscription_expired', 'subscription.deleted'],
    ])('maps %s to %s', (providerType, expected) => {
        const attributes = providerType === 'subscription_expired' ? { status: 'expired', ends_at: '2026-03-01T00:00:00Z' } : {}

        expect(provider.parseEvent(subscriptionBody(providerType, attributes)).type).toBe(expected)
    })

    it('reads ids, user, plan and period from the subscription resource', () => {
        const event = provider.parseEvent(subscriptionBody('subscription_created'))

        expect(event).toMatchObject({
            type: 'subscription.created',
            userId: USER_ID,
            providerCustomerId: '55',
            providerSubscriptionId: '77',
            planCode: 'pro',
            status: 'active',
            cancelAtPeriodEnd: false,
        })
        expect(event.currentPeriodEnd).toEqual(new Date('2026-04-01T00:00:00.000Z'))
        expect(event.occurredAt).toEqual(new Date('2026-03-01T10:00:00.000Z'))
    })

    it.each([
        ['101', 'plus'],
        ['102', 'plus'],
        ['201', 'pro'],
        ['202', 'pro'],
    ])('resolves variant %s to plan %s regardless of interval', (variantId, plan) => {
        const event = provider.parseEvent(subscriptionBody('subscription_updated', { variant_id: Number(variantId) }))

        expect(event.planCode).toBe(plan)
    })

    it('leaves planCode undefined for a variant it does not know', () => {
        const event = provider.parseEvent(subscriptionBody('subscription_updated', { variant_id: 999999 }))

        expect(event.planCode).toBeUndefined()
    })

    it('maps on_trial to trialing and carries the trial end', () => {
        const event = provider.parseEvent(
            subscriptionBody('subscription_created', { status: 'on_trial', trial_ends_at: '2026-03-15T00:00:00.000000Z' })
        )

        expect(event.status).toBe('trialing')
        expect(event.trialEndsAt).toEqual(new Date('2026-03-15T00:00:00.000Z'))
    })

    it.each([
        ['past_due', 'past_due'],
        ['unpaid', 'past_due'],
    ])('maps provider status %s to %s', (providerStatus, expected) => {
        expect(provider.parseEvent(subscriptionBody('subscription_updated', { status: providerStatus })).status).toBe(expected)
    })

    it('leaves status undefined for paused, which has no equivalent local state', () => {
        const event = provider.parseEvent(subscriptionBody('subscription_paused', { status: 'paused' }))

        expect(event.status).toBeUndefined()
    })

    it('treats cancelled-with-time-remaining as active until the end date, flagged to cancel', () => {
        const event = provider.parseEvent(
            subscriptionBody('subscription_cancelled', {
                status: 'cancelled',
                cancelled: true,
                renews_at: null,
                ends_at: '2026-05-01T00:00:00.000000Z',
            })
        )

        expect(event.status).toBe('active')
        expect(event.cancelAtPeriodEnd).toBe(true)
        expect(event.currentPeriodEnd).toEqual(new Date('2026-05-01T00:00:00.000Z'))
    })

    it('treats an expired subscription as cancelled', () => {
        const event = provider.parseEvent(
            subscriptionBody('subscription_expired', { status: 'expired', cancelled: true, renews_at: null, ends_at: '2026-03-01T00:00:00Z' })
        )

        expect(event.type).toBe('subscription.deleted')
        expect(event.status).toBe('cancelled')
    })

    it('leaves userId undefined when the checkout carried no custom data', () => {
        const event = provider.parseEvent(subscriptionBody('subscription_updated', {}, undefined))

        expect(event.userId).toBeUndefined()
    })

    it('ignores a non-string user_id in custom data', () => {
        const event = provider.parseEvent(subscriptionBody('subscription_created', {}, { user_id: { $ne: null } }))

        expect(event.userId).toBeUndefined()
    })
})

describe('parseEvent - payment, refund and unknown events', () => {
    it('maps a successful renewal to payment.succeeded, linked by subscription_id', () => {
        const event = provider.parseEvent(invoiceBody('subscription_payment_success'))

        expect(event).toMatchObject({
            type: 'payment.succeeded',
            providerCustomerId: '55',
            providerSubscriptionId: '77',
        })
        expect(event.occurredAt).toEqual(new Date('2026-04-01T00:00:05.000Z'))
    })

    it('maps a recovered payment to payment.succeeded', () => {
        expect(provider.parseEvent(invoiceBody('subscription_payment_recovered')).type).toBe('payment.succeeded')
    })

    it('maps a failed payment to payment.failed', () => {
        expect(provider.parseEvent(invoiceBody('subscription_payment_failed', { status: 'void' })).type).toBe('payment.failed')
    })

    it.each(['subscription_payment_refunded', 'order_refunded'])('maps %s to refund.issued', (providerType) => {
        expect(provider.parseEvent(invoiceBody(providerType, { refunded: true })).type).toBe('refund.issued')
    })

    it('carries no period end on payment events (the paired subscription_updated does)', () => {
        expect(provider.parseEvent(invoiceBody('subscription_payment_success')).currentPeriodEnd).toBeUndefined()
    })

    it('passes an unmapped provider event name through as its own type', () => {
        const event = provider.parseEvent(subscriptionBody('license_key_created'))

        expect(event.type).toBe('license_key_created')
    })

    it('never emits a plan or status for an event type it does not map', () => {
        const event = provider.parseEvent(subscriptionBody('license_key_created'))

        expect(event.planCode).toBeUndefined()
        expect(event.status).toBeUndefined()
        expect(event.userId).toBeUndefined()
    })
})

describe('parseEvent - event id and stored payload', () => {
    it('derives providerEventId from the body, as the provider sends no event id', () => {
        const raw = subscriptionBody('subscription_updated')
        const digest = crypto.createHash('sha256').update(raw).digest('hex')

        expect(provider.parseEvent(raw).providerEventId).toBe(`mor_${digest}`)
    })

    it('changes the id when updated_at changes', () => {
        const a = provider.parseEvent(subscriptionBody('subscription_updated'))
        const b = provider.parseEvent(subscriptionBody('subscription_updated', { updated_at: '2026-03-01T10:00:01.000000Z' }))

        expect(b.providerEventId).not.toBe(a.providerEventId)
    })

    it('stores a minimised payload with no email or name (billing ledger outlives erasure)', () => {
        const stored = JSON.stringify(provider.parseEvent(subscriptionBody('subscription_created')).payload)

        expect(stored).not.toContain('ada@example.com')
        expect(stored).not.toContain('Ada')
        expect(stored).not.toContain('Lovelace')
        expect(stored).not.toContain('signature=')
    })

    it('keeps the fields needed to audit an event', () => {
        const payload = provider.parseEvent(subscriptionBody('subscription_created')).payload as Record<string, unknown>

        expect(payload).toMatchObject({
            providerEventName: 'subscription_created',
            providerStatus: 'active',
            variantId: '201',
            providerCustomerId: '55',
            providerSubscriptionId: '77',
        })
    })

    it('keeps amount and currency for a payment event, still without personal data', () => {
        const payload = provider.parseEvent(invoiceBody('subscription_payment_success')).payload as Record<string, unknown>

        expect(payload).toMatchObject({ providerEventName: 'subscription_payment_success', total: 1200, currency: 'USD' })
        expect(JSON.stringify(payload)).not.toContain('ada@example.com')
    })

    it('stores a minimised payload even for an event type it does not map', () => {
        const stored = JSON.stringify(provider.parseEvent(subscriptionBody('license_key_created')).payload)

        expect(stored).not.toContain('ada@example.com')
        expect(stored).toContain('license_key_created')
    })
})

describe('parseEvent - malformed input', () => {
    it.each([
        ['no meta', { data: { type: 'subscriptions', id: '77', attributes: {} } }],
        ['no data', { meta: { event_name: 'subscription_created' } }],
        ['no event_name', { meta: {}, data: { type: 'subscriptions', id: '77', attributes: {} } }],
        ['non-string event_name', { meta: { event_name: 7 }, data: { type: 'subscriptions', id: '77', attributes: {} } }],
    ])('rejects a payload with %s', (_label, body) => {
        expect(() => provider.parseEvent(Buffer.from(JSON.stringify(body)))).toThrow(CustomError)
    })

    it('rejects a mapped event whose timestamp is unparseable', () => {
        expect(() => provider.parseEvent(subscriptionBody('subscription_updated', { updated_at: 'yesterday-ish' }))).toThrow(
            ERROR_MESSAGES.BILLING.WEBHOOK_PAYLOAD_INVALID
        )
    })
})

describe('createCheckoutSession', () => {
    const checkoutResponse = () =>
        json({ data: { type: 'checkouts', id: 'c1', attributes: { url: 'https://store.example.test/checkout/custom/c1?signature=z' } } }, 201)

    it('POSTs a JSON:API checkout for the store and the plan/interval variant', async () => {
        const fetchImpl = stubFetch(checkoutResponse)
        const p = createMorProvider(config, { fetchImpl })

        const session = await p.createCheckoutSession({
            userId: USER_ID,
            email: 'ada@example.com',
            planCode: 'pro',
            interval: 'annual',
        })

        expect(session.url).toBe('https://store.example.test/checkout/custom/c1?signature=z')
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('https://api.lemonsqueezy.com/v1/checkouts')
        expect(init.method).toBe('POST')
        const headers = init.headers as Record<string, string>
        expect(headers.Authorization).toBe('Bearer mor_live_key')
        expect(headers.Accept).toBe('application/vnd.api+json')
        expect(headers['Content-Type']).toBe('application/vnd.api+json')
        const body = JSON.parse(String(init.body))
        expect(body.data.type).toBe('checkouts')
        expect(body.data.relationships.store.data).toEqual({ type: 'stores', id: '9' })
        expect(body.data.relationships.variant.data).toEqual({ type: 'variants', id: '202' })
        expect(body.data.attributes.checkout_data.email).toBe('ada@example.com')
        expect(body.data.attributes.checkout_data.custom).toEqual({ user_id: USER_ID })
    })

    it.each([
        ['plus', 'monthly', '101'],
        ['plus', 'annual', '102'],
        ['pro', 'monthly', '201'],
        ['pro', 'annual', '202'],
    ] as const)('uses variant for %s %s', async (planCode, interval, variantId) => {
        const fetchImpl = stubFetch(checkoutResponse)
        const p = createMorProvider(config, { fetchImpl })

        await p.createCheckoutSession({ userId: USER_ID, email: 'a@b.co', planCode, interval })

        const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body))
        expect(body.data.relationships.variant.data.id).toBe(variantId)
    })

    it('passes returnUrl as the post-purchase redirect only when given', async () => {
        const fetchImpl = stubFetch(checkoutResponse)
        const p = createMorProvider(config, { fetchImpl })

        await p.createCheckoutSession({ userId: USER_ID, email: 'a@b.co', planCode: 'plus', interval: 'monthly' })
        await p.createCheckoutSession({
            userId: USER_ID,
            email: 'a@b.co',
            planCode: 'plus',
            interval: 'monthly',
            returnUrl: 'https://app.corvale.test/settings/billing',
        })

        const first = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body))
        const second = JSON.parse(String((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body))
        expect(first.data.attributes.product_options?.redirect_url).toBeUndefined()
        expect(second.data.attributes.product_options.redirect_url).toBe('https://app.corvale.test/settings/billing')
    })

    it('is a 502 with the generic message when the provider answers non-2xx, leaking neither key nor body', async () => {
        const fetchImpl = stubFetch(() => json({ errors: [{ detail: 'secret upstream detail mor_live_key' }] }, 422))
        const p = createMorProvider(config, { fetchImpl })

        let thrown: unknown
        try {
            await p.createCheckoutSession({ userId: USER_ID, email: 'a@b.co', planCode: 'plus', interval: 'monthly' })
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

        await expect(
            p.createCheckoutSession({ userId: USER_ID, email: 'a@b.co', planCode: 'plus', interval: 'monthly' })
        ).rejects.toMatchObject({ statusCode: 502, message: ERROR_MESSAGES.BILLING.PROVIDER_REQUEST_FAILED })
    })

    it('is a 502 when the response carries no checkout url', async () => {
        const fetchImpl = stubFetch(() => json({ data: { attributes: {} } }))
        const p = createMorProvider(config, { fetchImpl })

        await expect(
            p.createCheckoutSession({ userId: USER_ID, email: 'a@b.co', planCode: 'plus', interval: 'monthly' })
        ).rejects.toMatchObject({ statusCode: 502 })
    })

    it('refuses to hand back a non-https checkout url', async () => {
        const fetchImpl = stubFetch(() => json({ data: { attributes: { url: 'javascript:alert(1)' } } }))
        const p = createMorProvider(config, { fetchImpl })

        await expect(
            p.createCheckoutSession({ userId: USER_ID, email: 'a@b.co', planCode: 'plus', interval: 'monthly' })
        ).rejects.toMatchObject({ statusCode: 502 })
    })

    it('sends a timeout signal so a hung provider cannot hang the request', async () => {
        const fetchImpl = stubFetch(checkoutResponse)
        const p = createMorProvider(config, { fetchImpl })

        await p.createCheckoutSession({ userId: USER_ID, email: 'a@b.co', planCode: 'plus', interval: 'monthly' })

        expect((fetchImpl.mock.calls[0] as [string, RequestInit])[1].signal).toBeInstanceOf(AbortSignal)
    })
})

describe('getPortalUrl', () => {
    it('GETs the customer and returns its portal url', async () => {
        const fetchImpl = stubFetch(() =>
            json({ data: { type: 'customers', id: '55', attributes: { urls: { customer_portal: 'https://store.example.test/billing?s=1' } } } })
        )
        const p = createMorProvider(config, { fetchImpl })

        const portal = await p.getPortalUrl({ providerCustomerId: '55' })

        expect(portal.url).toBe('https://store.example.test/billing?s=1')
        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('https://api.lemonsqueezy.com/v1/customers/55')
        expect(init.method ?? 'GET').toBe('GET')
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer mor_live_key')
    })

    it('url-encodes the customer id so it cannot rewrite the request path', async () => {
        const fetchImpl = stubFetch(() => json({ data: { attributes: { urls: { customer_portal: 'https://x.test/p' } } } }))
        const p = createMorProvider(config, { fetchImpl })

        await p.getPortalUrl({ providerCustomerId: '55/../../subscriptions/1' })

        expect((fetchImpl.mock.calls[0] as [string, RequestInit])[0]).toBe(
            'https://api.lemonsqueezy.com/v1/customers/55%2F..%2F..%2Fsubscriptions%2F1'
        )
    })

    it('is a 502 when the customer has no portal url', async () => {
        const fetchImpl = stubFetch(() => json({ data: { attributes: { urls: {} } } }))
        const p = createMorProvider(config, { fetchImpl })

        await expect(p.getPortalUrl({ providerCustomerId: '55' })).rejects.toMatchObject({
            statusCode: 502,
            message: ERROR_MESSAGES.BILLING.PROVIDER_REQUEST_FAILED,
        })
    })

    it('is a 502 on a non-2xx answer', async () => {
        const fetchImpl = stubFetch(() => json({}, 404))
        const p = createMorProvider(config, { fetchImpl })

        await expect(p.getPortalUrl({ providerCustomerId: '55' })).rejects.toMatchObject({ statusCode: 502 })
    })
})
