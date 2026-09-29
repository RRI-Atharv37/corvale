import { describe, expect, it, vi } from 'vitest'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import { createMorProvider, type MorConfig } from '../morProvider'

/** M6 - the adapter's account-management side: invoices, plan change, cancel and resume, in Paddle's shapes (M3f.5). */

const config: MorConfig = {
    apiKey: 'mor_live_key',
    environment: 'sandbox',
    webhookSecret: 'mor_secret',
    prices: {
        plus: { monthly: '101', annual: '102' },
        pro: { monthly: '201', annual: '202' },
    },
}

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const stubFetch = (responder: (url: string, init: RequestInit) => Response | Promise<Response>) =>
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => responder(String(input), init ?? {})) as ReturnType<
        typeof vi.fn
    > &
        typeof fetch

const transaction = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    status: 'completed',
    customer_id: 'ctm_55',
    subscription_id: 'sub_77',
    origin: 'subscription_recurring',
    currency_code: 'USD',
    billed_at: '2026-04-01T00:00:00.000000Z',
    created_at: '2026-03-31T23:59:58.000000Z',
    customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
    payments: [{ method_details: { type: 'card', card: { last4: '4242', cardholder_name: 'Ada Lovelace' } } }],
    details: { totals: { subtotal: '1000', tax: '200', total: '1200' } },
    adjustments_totals: { total: '0', breakdown: { credit: '0', refund: '0', chargeback: '0' } },
    ...overrides,
})

const subscriptionResource = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    status: 'active',
    customer_id: 'ctm_55',
    created_at: '2026-03-01T09:00:00.000000Z',
    updated_at: '2026-03-01T10:00:00.000000Z',
    next_billed_at: '2026-04-01T00:00:00.000000Z',
    current_billing_period: { starts_at: '2026-03-01T00:00:00.000000Z', ends_at: '2026-04-01T00:00:00.000000Z' },
    scheduled_change: null,
    items: [{ status: 'active', quantity: 1, trial_dates: null, price: { id: '201' } }],
    ...overrides,
})

const callsOf = (fetchImpl: ReturnType<typeof stubFetch>) =>
    (fetchImpl.mock.calls as Array<[string, RequestInit]>).map(([url, init]) => ({
        path: new URL(url).pathname,
        query: new URL(url).searchParams,
        method: init.method,
        body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
        headers: init.headers as Record<string, string>,
    }))

describe('getSubscriptionSnapshot (M7.5)', () => {
    it('fetches the subscription by id, authenticated with the API key', async () => {
        const fetchImpl = stubFetch(() => json({ data: subscriptionResource('sub_77') }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.getSubscriptionSnapshot({ providerSubscriptionId: 'sub_77' })

        const [call] = callsOf(fetchImpl)
        expect(call.path).toBe('/subscriptions/sub_77')
        expect(call.method).toBe('GET')
        expect(call.headers.Authorization).toBe('Bearer mor_live_key')
    })

    it('maps the found subscription the same way listSubscriptions does', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ data: subscriptionResource('sub_77') })) })

        const snapshot = await provider.getSubscriptionSnapshot({ providerSubscriptionId: 'sub_77' })

        expect(snapshot).toMatchObject({ providerSubscriptionId: 'sub_77', providerCustomerId: 'ctm_55', planCode: 'pro', status: 'active' })
    })

    it('encodes the subscription id into the path', async () => {
        const fetchImpl = stubFetch(() => json({ data: subscriptionResource('sub_77') }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.getSubscriptionSnapshot({ providerSubscriptionId: 'sub_77/../../customers' })

        expect(callsOf(fetchImpl)[0].path).toBe('/subscriptions/sub_77%2F..%2F..%2Fcustomers')
    })

    it('resolves to null when the provider no longer has it, rather than throwing', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ error: {} }, 404)) })

        await expect(provider.getSubscriptionSnapshot({ providerSubscriptionId: 'sub_77' })).resolves.toBeNull()
    })

    it('fails as a 502 for any other provider error, and for a body with no subscription', async () => {
        const failing = createMorProvider(config, { fetchImpl: stubFetch(() => json({ error: {} }, 500)) })
        const empty = createMorProvider(config, { fetchImpl: stubFetch(() => json({})) })

        await expect(failing.getSubscriptionSnapshot({ providerSubscriptionId: 'sub_77' })).rejects.toMatchObject({ statusCode: 502 })
        await expect(empty.getSubscriptionSnapshot({ providerSubscriptionId: 'sub_77' })).rejects.toMatchObject({ statusCode: 502 })
    })
})

describe('refundInvoice (M7.5)', () => {
    const lineItem = (id: string) => ({ id, price_id: '201', quantity: 1, totals: { subtotal: '1000', tax: '200', total: '1200' } })
    const detail = (lineItems: unknown[] = [lineItem('txnitm_1')], total = '1200') => ({
        data: transaction('txn_9001', { details: { totals: { total }, line_items: lineItems } }),
    })
    const respond = (lookup: Response, adjustment: Response = json({ data: { id: 'adj_1', status: 'pending_approval' } })) =>
        stubFetch((_url, init) => (init.method === 'POST' ? adjustment : lookup))

    it('looks the transaction up, then posts a full refund when the amount is the whole total', async () => {
        const fetchImpl = respond(json(detail()))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.refundInvoice({ providerInvoiceId: 'txn_9001', amountMinor: 1200 })

        const [lookup, refund] = callsOf(fetchImpl)
        expect(lookup).toMatchObject({ path: '/transactions/txn_9001', method: 'GET' })
        expect(refund.path).toBe('/adjustments')
        expect(refund.method).toBe('POST')
        expect(refund.headers.Authorization).toBe('Bearer mor_live_key')
        expect(refund.body).toEqual({
            action: 'refund',
            type: 'full',
            transaction_id: 'txn_9001',
            reason: expect.any(String),
        })
    })

    it('posts a partial refund against the transactions single line item for a smaller amount', async () => {
        const fetchImpl = respond(json(detail()))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.refundInvoice({ providerInvoiceId: 'txn_9001', amountMinor: 500 })

        expect(callsOf(fetchImpl)[1].body).toEqual({
            action: 'refund',
            type: 'partial',
            transaction_id: 'txn_9001',
            reason: expect.any(String),
            items: [{ item_id: 'txnitm_1', type: 'partial', amount: '500' }],
        })
    })

    it.each([
        ['more than one line item', [lineItem('txnitm_1'), lineItem('txnitm_2')]],
        ['no line item', []],
        ['a line item with no id', [{ price_id: '201' }]],
    ])('refuses a partial refund when the transaction has %s, without posting anything', async (_label, lineItems) => {
        const fetchImpl = respond(json(detail(lineItems)))
        const provider = createMorProvider(config, { fetchImpl })

        await expect(provider.refundInvoice({ providerInvoiceId: 'txn_9001', amountMinor: 500 })).rejects.toMatchObject({ statusCode: 502 })
        expect(callsOf(fetchImpl).map((call) => call.method)).toEqual(['GET'])
    })

    it('refuses an amount above the transaction total, without posting anything', async () => {
        const fetchImpl = respond(json(detail()))
        const provider = createMorProvider(config, { fetchImpl })

        await expect(provider.refundInvoice({ providerInvoiceId: 'txn_9001', amountMinor: 1201 })).rejects.toMatchObject({ statusCode: 502 })
        expect(callsOf(fetchImpl).map((call) => call.method)).toEqual(['GET'])
    })

    it.each([0, -5, 12.5, Number.NaN])('refuses an amount of %s before calling the provider at all', async (amountMinor) => {
        const fetchImpl = respond(json(detail()))
        const provider = createMorProvider(config, { fetchImpl })

        await expect(provider.refundInvoice({ providerInvoiceId: 'txn_9001', amountMinor })).rejects.toMatchObject({ statusCode: 502 })
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('refuses when the transaction reports no total', async () => {
        const fetchImpl = respond(json({ data: transaction('txn_9001', { details: {} }) }))
        const provider = createMorProvider(config, { fetchImpl })

        await expect(provider.refundInvoice({ providerInvoiceId: 'txn_9001', amountMinor: 500 })).rejects.toMatchObject({ statusCode: 502 })
        expect(callsOf(fetchImpl).map((call) => call.method)).toEqual(['GET'])
    })

    it('encodes the transaction id into the lookup path', async () => {
        const fetchImpl = respond(json(detail()))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.refundInvoice({ providerInvoiceId: 'txn_1/../../customers', amountMinor: 1200 })

        expect(callsOf(fetchImpl)[0].path).toBe('/transactions/txn_1%2F..%2F..%2Fcustomers')
    })

    it('fails as a 502 when the lookup or the refund is refused', async () => {
        const noLookup = createMorProvider(config, { fetchImpl: respond(json({}, 404)) })
        const noRefund = createMorProvider(config, { fetchImpl: respond(json(detail()), json({ error: {} }, 422)) })

        await expect(noLookup.refundInvoice({ providerInvoiceId: 'txn_9001', amountMinor: 1200 })).rejects.toMatchObject({ statusCode: 502 })
        await expect(noRefund.refundInvoice({ providerInvoiceId: 'txn_9001', amountMinor: 1200 })).rejects.toMatchObject({ statusCode: 502 })
    })

    it('resolves to nothing: the resulting status arrives on a webhook', async () => {
        const provider = createMorProvider(config, { fetchImpl: respond(json(detail())) })

        await expect(provider.refundInvoice({ providerInvoiceId: 'txn_9001', amountMinor: 1200 })).resolves.toBeUndefined()
    })
})

describe('listInvoices', () => {
    it("asks for one subscription's transactions, with refund totals, authenticated with the API key", async () => {
        const fetchImpl = stubFetch(() => json({ data: [] }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.listInvoices({ providerSubscriptionId: 'sub_77' })

        const [call] = callsOf(fetchImpl)
        expect(call.path).toBe('/transactions')
        expect(call.method).toBe('GET')
        expect(call.query.get('subscription_id')).toBe('sub_77')
        expect(call.query.get('include')).toBe('adjustments_totals')
        expect(Number(call.query.get('per_page'))).toBeGreaterThan(0)
        expect(Number(call.query.get('per_page'))).toBeLessThanOrEqual(30)
        expect(call.headers.Authorization).toBe('Bearer mor_live_key')
    })

    it('never asks for a draft or unpaid checkout transaction', async () => {
        const fetchImpl = stubFetch(() => json({ data: [] }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.listInvoices({ providerSubscriptionId: 'sub_77' })

        const statuses = (callsOf(fetchImpl)[0].query.get('status') ?? '').split(',')
        expect(statuses).not.toContain('draft')
        expect(statuses).not.toContain('ready')
        expect(statuses).toEqual(expect.arrayContaining(['completed', 'billed', 'past_due', 'canceled']))
    })

    it('reduces each transaction to id, date, amount and status - never an email, a name or a card, and no link', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ data: [transaction('txn_9001')] })) })

        const [entry] = await provider.listInvoices({ providerSubscriptionId: 'sub_77' })

        expect(entry).toEqual({
            id: 'txn_9001',
            issuedAt: new Date('2026-04-01T00:00:00.000Z'),
            total: 1200,
            currency: 'USD',
            status: 'paid',
            url: null,
        })
        for (const banned of ['ada@example.com', 'Ada', '4242']) expect(JSON.stringify(entry)).not.toContain(banned)
    })

    it('falls back to the creation time when a transaction has not been billed', async () => {
        const provider = createMorProvider(config, {
            fetchImpl: stubFetch(() => json({ data: [transaction('txn_1', { status: 'past_due', billed_at: null })] })),
        })

        const [entry] = await provider.listInvoices({ providerSubscriptionId: 'sub_77' })

        expect(entry.issuedAt).toEqual(new Date('2026-03-31T23:59:58.000Z'))
    })

    it('returns the newest invoice first', async () => {
        const provider = createMorProvider(config, {
            fetchImpl: stubFetch(() =>
                json({
                    data: [
                        transaction('1', { billed_at: '2026-02-01T00:00:00.000000Z' }),
                        transaction('3', { billed_at: '2026-04-01T00:00:00.000000Z' }),
                        transaction('2', { billed_at: '2026-03-01T00:00:00.000000Z' }),
                    ],
                })
            ),
        })

        const entries = await provider.listInvoices({ providerSubscriptionId: 'sub_77' })

        expect(entries.map((entry) => entry.id)).toEqual(['3', '2', '1'])
    })

    it.each([
        ['completed', '0', 'paid'],
        ['paid', '0', 'paid'],
        ['billed', '0', 'pending'],
        ['past_due', '0', 'pending'],
        ['canceled', '0', 'void'],
        ['something_new', '0', 'pending'],
        ['completed', '1200', 'refunded'],
        ['completed', '500', 'refunded'],
    ])('maps provider status %s with %s refunded to %s', async (status, refunded, expected) => {
        const provider = createMorProvider(config, {
            fetchImpl: stubFetch(() =>
                json({ data: [transaction('1', { status, adjustments_totals: { breakdown: { refund: refunded, credit: '0', chargeback: '0' } } })] })
            ),
        })

        const [entry] = await provider.listInvoices({ providerSubscriptionId: 'sub_77' })

        expect(entry.status).toBe(expected)
    })

    it('does not read a missing or malformed adjustments total as a refund', async () => {
        const provider = createMorProvider(config, {
            fetchImpl: stubFetch(() =>
                json({
                    data: [
                        transaction('1', { adjustments_totals: undefined }),
                        transaction('2', { adjustments_totals: { breakdown: { refund: 'lots' } } }),
                    ],
                })
            ),
        })

        const entries = await provider.listInvoices({ providerSubscriptionId: 'sub_77' })

        expect(entries.map((entry) => entry.status)).toEqual(['paid', 'paid'])
    })

    it('reads the amount as minor units and drops a total it cannot trust to zero', async () => {
        const provider = createMorProvider(config, {
            fetchImpl: stubFetch(() => json({ data: [transaction('1', { details: { totals: { total: 'lots' } } })] })),
        })

        const [entry] = await provider.listInvoices({ providerSubscriptionId: 'sub_77' })

        expect(entry.total).toBe(0)
    })

    it('skips an entry with no id or no usable date instead of inventing one', async () => {
        const provider = createMorProvider(config, {
            fetchImpl: stubFetch(() =>
                json({ data: [transaction('1'), { status: 'completed' }, transaction('2', { billed_at: 'nope', created_at: 'nope' })] })
            ),
        })

        const entries = await provider.listInvoices({ providerSubscriptionId: 'sub_77' })

        expect(entries.map((entry) => entry.id)).toEqual(['1'])
    })

    it('answers an empty list for a body with no data array', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ data: {} })) })

        expect(await provider.listInvoices({ providerSubscriptionId: 'sub_77' })).toEqual([])
    })

    it('fails as a 502 when the provider refuses', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ error: {} }, 500)) })

        await expect(provider.listInvoices({ providerSubscriptionId: 'sub_77' })).rejects.toMatchObject({
            statusCode: 502,
            message: ERROR_MESSAGES.BILLING.PROVIDER_REQUEST_FAILED,
        })
    })
})

describe('changePlan', () => {
    it('patches the subscription onto the price of the chosen plan and interval, prorated immediately', async () => {
        const fetchImpl = stubFetch(() => json({ data: subscriptionResource('sub_77') }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.changePlan({ providerSubscriptionId: 'sub_77', planCode: 'pro', interval: 'annual' })

        const [call] = callsOf(fetchImpl)
        expect(call.path).toBe('/subscriptions/sub_77')
        expect(call.method).toBe('PATCH')
        expect(call.headers['Content-Type']).toBe('application/json')
        expect(call.body).toEqual({
            items: [{ price_id: '202', quantity: 1 }],
            proration_billing_mode: 'prorated_immediately',
        })
    })

    it.each([
        ['plus', 'monthly', '101'],
        ['plus', 'annual', '102'],
        ['pro', 'monthly', '201'],
        ['pro', 'annual', '202'],
    ] as const)('sends price %s %s -> %s', async (planCode, interval, priceId) => {
        const fetchImpl = stubFetch(() => json({ data: subscriptionResource('sub_77') }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.changePlan({ providerSubscriptionId: 'sub_77', planCode, interval })

        expect(callsOf(fetchImpl)[0].body.items).toEqual([{ price_id: priceId, quantity: 1 }])
    })

    it('encodes the subscription id into the path', async () => {
        const fetchImpl = stubFetch(() => json({ data: subscriptionResource('sub_77') }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.changePlan({ providerSubscriptionId: 'sub_77/../../customers', planCode: 'plus', interval: 'monthly' })

        expect(callsOf(fetchImpl)[0].path).toBe('/subscriptions/sub_77%2F..%2F..%2Fcustomers')
    })

    it('resolves to nothing: the new plan arrives on a webhook', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ data: subscriptionResource('sub_77') })) })

        await expect(
            provider.changePlan({ providerSubscriptionId: 'sub_77', planCode: 'plus', interval: 'monthly' })
        ).resolves.toBeUndefined()
    })

    it('fails as a 502 when the provider refuses', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ error: {} }, 422)) })

        await expect(
            provider.changePlan({ providerSubscriptionId: 'sub_77', planCode: 'plus', interval: 'monthly' })
        ).rejects.toBeInstanceOf(CustomError)
    })
})

describe('cancelSubscription', () => {
    it('cancels at the next billing period by default', async () => {
        const fetchImpl = stubFetch(() => json({ data: subscriptionResource('sub_77') }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.cancelSubscription({ providerSubscriptionId: 'sub_77' })

        const [call] = callsOf(fetchImpl)
        expect(call.path).toBe('/subscriptions/sub_77/cancel')
        expect(call.method).toBe('POST')
        expect(call.body).toEqual({ effective_from: 'next_billing_period' })
    })

    it('cancels immediately when asked to (account erasure, staff cancel-now)', async () => {
        const fetchImpl = stubFetch(() => json({ data: subscriptionResource('sub_77') }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.cancelSubscription({ providerSubscriptionId: 'sub_77', immediate: true })

        expect(callsOf(fetchImpl)[0].body).toEqual({ effective_from: 'immediately' })
    })

    it('treats immediate: false as a period-end cancel', async () => {
        const fetchImpl = stubFetch(() => json({ data: subscriptionResource('sub_77') }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.cancelSubscription({ providerSubscriptionId: 'sub_77', immediate: false })

        expect(callsOf(fetchImpl)[0].body).toEqual({ effective_from: 'next_billing_period' })
    })

    it('encodes the subscription id into the path', async () => {
        const fetchImpl = stubFetch(() => json({ data: subscriptionResource('sub_77') }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.cancelSubscription({ providerSubscriptionId: 'sub_77/../../customers' })

        expect(callsOf(fetchImpl)[0].path).toBe('/subscriptions/sub_77%2F..%2F..%2Fcustomers/cancel')
    })

    it('fails as a 502 when the provider refuses', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({}, 404)) })

        await expect(provider.cancelSubscription({ providerSubscriptionId: 'sub_77' })).rejects.toMatchObject({ statusCode: 502 })
    })
})

describe('resumeSubscription', () => {
    it('clears the scheduled change, which is how a scheduled cancel is undone', async () => {
        const fetchImpl = stubFetch(() => json({ data: subscriptionResource('sub_77') }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.resumeSubscription({ providerSubscriptionId: 'sub_77' })

        const [call] = callsOf(fetchImpl)
        expect(call.path).toBe('/subscriptions/sub_77')
        expect(call.method).toBe('PATCH')
        expect(call.body).toEqual({ scheduled_change: null })
    })

    it('never uses the paused-subscription resume endpoint, which would bill immediately', async () => {
        const fetchImpl = stubFetch(() => json({ data: subscriptionResource('sub_77') }))
        const provider = createMorProvider(config, { fetchImpl })

        await provider.resumeSubscription({ providerSubscriptionId: 'sub_77' })

        expect(callsOf(fetchImpl).map((call) => call.path)).not.toContain('/subscriptions/sub_77/resume')
    })

    it('fails as a 502 when the provider refuses (a subscription already canceled cannot be reinstated)', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({ error: {} }, 400)) })

        await expect(provider.resumeSubscription({ providerSubscriptionId: 'sub_77' })).rejects.toMatchObject({ statusCode: 502 })
    })
})
