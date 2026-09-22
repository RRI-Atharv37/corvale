import { describe, expect, it, vi } from 'vitest'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import { createMorProvider, type MorConfig } from '../morProvider'

/** M6 - the adapter's account-management side: invoices, plan change, cancel and resume. */

const config: MorConfig = {
    apiKey: 'mor_live_key',
    storeId: '9',
    webhookSecret: 'mor_secret',
    variants: {
        plus: { monthly: '101', annual: '102' },
        pro: { monthly: '201', annual: '202' },
    },
}

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/vnd.api+json' } })

const stubFetch = (responder: (url: string, init: RequestInit) => Response | Promise<Response>) =>
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => responder(String(input), init ?? {})) as ReturnType<
        typeof vi.fn
    > &
        typeof fetch

const invoice = (id: string, attributes: Record<string, unknown> = {}) => ({
    type: 'subscription-invoices',
    id,
    attributes: {
        store_id: 9,
        subscription_id: 77,
        customer_id: 55,
        status: 'paid',
        refunded: false,
        total: 1200,
        currency: 'USD',
        billing_reason: 'renewal',
        user_email: 'ada@example.com',
        user_name: 'Ada Lovelace',
        urls: { invoice_url: 'https://store.example.test/invoice/abc?signature=s' },
        created_at: '2026-04-01T00:00:00.000000Z',
        updated_at: '2026-04-01T00:00:05.000000Z',
        ...attributes,
    },
})

const subscriptionResource = (id: string, attributes: Record<string, unknown> = {}) => ({
    type: 'subscriptions',
    id,
    attributes: {
        customer_id: 55,
        variant_id: 201,
        status: 'active',
        cancelled: false,
        trial_ends_at: null,
        renews_at: '2026-04-01T00:00:00.000000Z',
        ends_at: null,
        created_at: '2026-03-01T09:00:00.000000Z',
        updated_at: '2026-03-01T10:00:00.000000Z',
        ...attributes,
    },
})

describe('getSubscriptionSnapshot (M7.5)', () => {
    it('fetches the subscription by id, authenticated with the API key', async () => {
        const fetchImpl = stubFetch(() => json({ data: subscriptionResource('77') }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.getSubscriptionSnapshot({ providerSubscriptionId: '77' })

        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
        expect(new URL(url).pathname).toBe('/v1/subscriptions/77')
        expect(init.method).toBe('GET')
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer mor_live_key')
    })

    it('maps the found subscription the same way listSubscriptions does', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ data: subscriptionResource('77') })) })

        const snapshot = await provider.getSubscriptionSnapshot({ providerSubscriptionId: '77' })

        expect(snapshot).toMatchObject({ providerSubscriptionId: '77', providerCustomerId: '55', planCode: 'pro', status: 'active' })
    })

    it('resolves to null when the provider no longer has it, rather than throwing', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ errors: [] }, 404)) })

        await expect(provider.getSubscriptionSnapshot({ providerSubscriptionId: '77' })).resolves.toBeNull()
    })

    it('fails as a 502 for any other provider error', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ errors: [] }, 500)) })

        await expect(provider.getSubscriptionSnapshot({ providerSubscriptionId: '77' })).rejects.toMatchObject({ statusCode: 502 })
    })
})

describe('refundInvoice (M7.5)', () => {
    it('posts the refund amount to the invoice, authenticated with the API key', async () => {
        const fetchImpl = stubFetch(() => json({ data: {} }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.refundInvoice({ providerInvoiceId: '9001', amountMinor: 1200 })

        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
        expect(new URL(url).pathname).toBe('/v1/subscription-invoices/9001/refund')
        expect(init.method).toBe('POST')
        expect(JSON.parse(String(init.body))).toEqual({
            data: { type: 'subscription-invoices', id: '9001', attributes: { amount: 1200 } },
        })
    })

    it('fails as a 502 when the provider refuses', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ errors: [] }, 422)) })

        await expect(provider.refundInvoice({ providerInvoiceId: '9001', amountMinor: 1200 })).rejects.toMatchObject({ statusCode: 502 })
    })
})

describe('listInvoices', () => {
    it('asks for one subscription of this store, authenticated with the API key', async () => {
        const fetchImpl = stubFetch(() => json({ data: [] }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.listInvoices({ providerSubscriptionId: '77' })

        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
        const requested = new URL(url)
        expect(requested.pathname).toBe('/v1/subscription-invoices')
        expect(requested.searchParams.get('filter[store_id]')).toBe('9')
        expect(requested.searchParams.get('filter[subscription_id]')).toBe('77')
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer mor_live_key')
    })

    it('reduces each invoice to id, date, amount, status and a hosted link - never an email or a name', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ data: [invoice('9001')] })) })

        const [entry] = await provider.listInvoices({ providerSubscriptionId: '77' })

        expect(entry).toEqual({
            id: '9001',
            issuedAt: new Date('2026-04-01T00:00:00.000Z'),
            total: 1200,
            currency: 'USD',
            status: 'paid',
            url: 'https://store.example.test/invoice/abc?signature=s',
        })
        expect(JSON.stringify(entry)).not.toContain('ada@example.com')
        expect(JSON.stringify(entry)).not.toContain('Ada')
    })

    it('returns the newest invoice first', async () => {
        const provider = createMorProvider(config, {
            fetchImpl: stubFetch(() =>
                json({
                    data: [
                        invoice('1', { created_at: '2026-02-01T00:00:00.000000Z' }),
                        invoice('3', { created_at: '2026-04-01T00:00:00.000000Z' }),
                        invoice('2', { created_at: '2026-03-01T00:00:00.000000Z' }),
                    ],
                })
            ),
        })

        const entries = await provider.listInvoices({ providerSubscriptionId: '77' })

        expect(entries.map((entry) => entry.id)).toEqual(['3', '2', '1'])
    })

    it.each([
        ['paid', false, 'paid'],
        ['pending', false, 'pending'],
        ['void', false, 'void'],
        ['refunded', true, 'refunded'],
        ['partial_refund', true, 'refunded'],
        ['paid', true, 'refunded'],
        ['something_new', false, 'pending'],
    ])('maps provider status %s (refunded=%s) to %s', async (status, refunded, expected) => {
        const provider = createMorProvider(config, {
            fetchImpl: stubFetch(() => json({ data: [invoice('1', { status, refunded })] })),
        })

        const [entry] = await provider.listInvoices({ providerSubscriptionId: '77' })

        expect(entry.status).toBe(expected)
    })

    it('drops a hosted link that is not https rather than hand the browser an unsafe URL', async () => {
        const provider = createMorProvider(config, {
            fetchImpl: stubFetch(() => json({ data: [invoice('1', { urls: { invoice_url: 'javascript:alert(1)' } })] })),
        })

        const [entry] = await provider.listInvoices({ providerSubscriptionId: '77' })

        expect(entry.url).toBeNull()
    })

    it('skips an entry with no id or no usable date instead of inventing one', async () => {
        const provider = createMorProvider(config, {
            fetchImpl: stubFetch(() =>
                json({ data: [invoice('1'), { type: 'subscription-invoices', attributes: {} }, invoice('2', { created_at: 'nope' })] })
            ),
        })

        const entries = await provider.listInvoices({ providerSubscriptionId: '77' })

        expect(entries.map((entry) => entry.id)).toEqual(['1'])
    })

    it('answers an empty list for a body with no data array', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ data: {} })) })

        expect(await provider.listInvoices({ providerSubscriptionId: '77' })).toEqual([])
    })

    it('fails as a 502 when the provider refuses', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ errors: [] }, 500)) })

        await expect(provider.listInvoices({ providerSubscriptionId: '77' })).rejects.toMatchObject({
            statusCode: 502,
            message: ERROR_MESSAGES.BILLING.PROVIDER_REQUEST_FAILED,
        })
    })
})

describe('changePlan', () => {
    it('patches the subscription onto the variant of the chosen plan and interval', async () => {
        const fetchImpl = stubFetch(() => json({ data: { attributes: {} } }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.changePlan({ providerSubscriptionId: '77', planCode: 'pro', interval: 'annual' })

        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
        expect(new URL(url).pathname).toBe('/v1/subscriptions/77')
        expect(init.method).toBe('PATCH')
        expect(JSON.parse(String(init.body))).toEqual({
            data: { type: 'subscriptions', id: '77', attributes: { variant_id: 202 } },
        })
    })

    it('encodes the subscription id into the path', async () => {
        const fetchImpl = stubFetch(() => json({ data: { attributes: {} } }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.changePlan({ providerSubscriptionId: '77/../../customers', planCode: 'plus', interval: 'monthly' })

        expect(new URL((fetchImpl.mock.calls[0] as [string])[0]).pathname).toBe('/v1/subscriptions/77%2F..%2F..%2Fcustomers')
    })

    it('fails as a 502 when the provider refuses', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ errors: [] }, 422)) })

        await expect(
            provider.changePlan({ providerSubscriptionId: '77', planCode: 'plus', interval: 'monthly' })
        ).rejects.toBeInstanceOf(CustomError)
    })
})

describe('cancelSubscription', () => {
    it('deletes the subscription, which the provider ends at the period end', async () => {
        const fetchImpl = stubFetch(() => json({ data: { attributes: {} } }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.cancelSubscription({ providerSubscriptionId: '77' })

        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
        expect(new URL(url).pathname).toBe('/v1/subscriptions/77')
        expect(init.method).toBe('DELETE')
        expect(init.body).toBeUndefined()
    })

    it('fails as a 502 when the provider refuses', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({}, 404)) })

        await expect(provider.cancelSubscription({ providerSubscriptionId: '77' })).rejects.toMatchObject({ statusCode: 502 })
    })
})

describe('resumeSubscription', () => {
    it('patches the subscription back to not cancelled', async () => {
        const fetchImpl = stubFetch(() => json({ data: { attributes: {} } }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.resumeSubscription({ providerSubscriptionId: '77' })

        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
        expect(new URL(url).pathname).toBe('/v1/subscriptions/77')
        expect(init.method).toBe('PATCH')
        expect(JSON.parse(String(init.body))).toEqual({
            data: { type: 'subscriptions', id: '77', attributes: { cancelled: false } },
        })
    })

    it('fails as a 502 when the provider refuses', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({}, 500)) })

        await expect(provider.resumeSubscription({ providerSubscriptionId: '77' })).rejects.toMatchObject({ statusCode: 502 })
    })
})
