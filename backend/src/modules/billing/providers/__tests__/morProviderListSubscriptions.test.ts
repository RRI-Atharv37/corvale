import { describe, expect, it, vi } from 'vitest'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import { createMorProvider, type MorConfig } from '../morProvider'

/** M3d - the adapter's read side: every subscription of the account, reduced to what reconciliation compares (Paddle shapes, M3f.5). */

const config: MorConfig = {
    apiKey: 'mor_live_key',
    environment: 'sandbox',
    webhookSecret: 'mor_secret',
    prices: {
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

const resource = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    status: 'active',
    customer_id: 'ctm_55',
    address_id: 'add_1',
    currency_code: 'USD',
    created_at: '2026-03-01T09:00:00.000000Z',
    updated_at: '2026-03-01T10:00:00.000000Z',
    next_billed_at: '2026-04-01T00:00:00.000000Z',
    current_billing_period: { starts_at: '2026-03-01T00:00:00.000000Z', ends_at: '2026-04-01T00:00:00.000000Z' },
    scheduled_change: null,
    billing_details: { additional_information: 'Ada Lovelace ada@example.com' },
    management_urls: { cancel: 'https://buyer-portal.paddle.com/subscriptions/x/cancel?token=secret-token' },
    items: [{ status: 'active', quantity: 1, trial_dates: null, price: { id: '201' } }],
    ...overrides,
})

const page = (data: unknown[], hasMore = false) => ({
    data,
    meta: { request_id: 'r1', pagination: { per_page: 200, next: 'https://api.paddle.com/subscriptions?after=x', has_more: hasMore, estimated_total: data.length } },
})

const providerReturning = (...pages: unknown[]) => {
    const fetchImpl = stubFetch((url) => {
        const after = new URL(url).searchParams.get('after')
        const index = after === null ? 0 : Number(after.replace('sub_', ''))
        return json(pages[index] ?? page([]))
    })
    return { provider: createMorProvider(config, { fetchImpl }), fetchImpl }
}

describe('listSubscriptions', () => {
    it('asks for the account, a page at a time in a stable order, authenticated with the API key', async () => {
        const { provider, fetchImpl } = providerReturning(page([]))

        await provider.listSubscriptions()

        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
        const requested = new URL(url)
        expect(requested.origin).toBe('https://sandbox-api.paddle.com')
        expect(requested.pathname).toBe('/subscriptions')
        expect(Number(requested.searchParams.get('per_page'))).toBeGreaterThan(0)
        expect(Number(requested.searchParams.get('per_page'))).toBeLessThanOrEqual(200)
        expect(requested.searchParams.get('order_by')).toBe('id[ASC]')
        expect(requested.searchParams.has('after')).toBe(false)
        expect(init.method).toBe('GET')
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer mor_live_key')
    })

    it('does not filter by status, so canceled subscriptions reach reconciliation too', async () => {
        const { provider, fetchImpl } = providerReturning(page([]))

        await provider.listSubscriptions()

        expect(new URL((fetchImpl.mock.calls[0] as [string])[0]).searchParams.has('status')).toBe(false)
    })

    it('normalises ids, plan, status, dates and time', async () => {
        const items = [{ status: 'trialing', quantity: 1, price: { id: '201' }, trial_dates: { starts_at: '2026-03-01T00:00:00Z', ends_at: '2026-03-15T00:00:00.000000Z' } }]
        const { provider } = providerReturning(page([resource('sub_77', { items })]))

        const [snapshot] = await provider.listSubscriptions()

        expect(snapshot).toEqual({
            providerSubscriptionId: 'sub_77',
            providerCustomerId: 'ctm_55',
            planCode: 'pro',
            status: 'active',
            currentPeriodEnd: new Date('2026-04-01T00:00:00.000Z'),
            trialEndsAt: new Date('2026-03-15T00:00:00.000Z'),
            cancelAtPeriodEnd: false,
            updatedAt: new Date('2026-03-01T10:00:00.000Z'),
        })
    })

    it('never carries an email, a name or a portal token', async () => {
        const { provider } = providerReturning(page([resource('sub_77')]))

        const snapshots = await provider.listSubscriptions()

        expect(JSON.stringify(snapshots)).not.toMatch(/ada@example\.com|Ada Lovelace|secret-token/)
    })

    it('follows the cursor, sending the last id of each page as `after`, until there are no more', async () => {
        const { provider, fetchImpl } = providerReturning(
            page([resource('sub_a'), resource('sub_1')], true),
            page([resource('sub_b'), resource('sub_2')], true),
            page([resource('sub_c')], false)
        )

        const snapshots = await provider.listSubscriptions()

        expect(snapshots.map((snapshot) => snapshot.providerSubscriptionId)).toEqual(['sub_a', 'sub_1', 'sub_b', 'sub_2', 'sub_c'])
        const afters = (fetchImpl.mock.calls as Array<[string]>).map(([url]) => new URL(url).searchParams.get('after'))
        expect(afters).toEqual([null, 'sub_1', 'sub_2'])
    })

    it('never follows the `next` url the provider hands back, only its own host', async () => {
        const hostile = { ...page([resource('sub_1')], true), meta: { pagination: { has_more: true, next: 'https://evil.example/steal?after=sub_1' } } }
        const { provider, fetchImpl } = providerReturning(hostile, page([resource('sub_2')], false))

        await provider.listSubscriptions()

        for (const [url] of fetchImpl.mock.calls as Array<[string]>) expect(new URL(url).origin).toBe('https://sandbox-api.paddle.com')
    })

    it('treats a response with no pagination metadata as the only page', async () => {
        const { provider, fetchImpl } = providerReturning({ data: [resource('sub_77')] })

        const snapshots = await provider.listSubscriptions()

        expect(snapshots).toHaveLength(1)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('maps a subscription scheduled to cancel to active + cancelAtPeriodEnd, ending at the effective date', async () => {
        const { provider } = providerReturning(
            page([resource('sub_77', { scheduled_change: { action: 'cancel', effective_at: '2099-01-01T00:00:00.000000Z', resume_at: null } })])
        )

        const [snapshot] = await provider.listSubscriptions()

        expect(snapshot.status).toBe('active')
        expect(snapshot.cancelAtPeriodEnd).toBe(true)
        expect(snapshot.currentPeriodEnd).toEqual(new Date('2099-01-01T00:00:00.000Z'))
    })

    it.each([
        ['trialing', 'trialing'],
        ['past_due', 'past_due'],
        ['canceled', 'cancelled'],
    ])('maps provider status %s to %s', async (providerStatus, expected) => {
        const { provider } = providerReturning(page([resource('sub_77', { status: providerStatus })]))

        const [snapshot] = await provider.listSubscriptions()

        expect(snapshot.status).toBe(expected)
    })

    it('leaves the status out for a state that maps to none (paused) rather than guessing', async () => {
        const { provider } = providerReturning(page([resource('sub_77', { status: 'paused' })]))

        const [snapshot] = await provider.listSubscriptions()

        expect(snapshot.status).toBeUndefined()
    })

    it('leaves the plan out for a price that is not in the configured catalogue', async () => {
        const items = [{ status: 'active', quantity: 1, trial_dates: null, price: { id: 'pri_unknown' } }]
        const { provider } = providerReturning(page([resource('sub_77', { items })]))

        const [snapshot] = await provider.listSubscriptions()

        expect(snapshot.planCode).toBeUndefined()
    })

    it('fails as a 502 when the provider refuses the request', async () => {
        const provider = createMorProvider(config, { fetchImpl: stubFetch(() => json({}, 401)) })

        const failure = await provider.listSubscriptions().catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(CustomError)
        expect((failure as CustomError).statusCode).toBe(502)
        expect((failure as CustomError).message).toBe(ERROR_MESSAGES.BILLING.PROVIDER_REQUEST_FAILED)
    })

    it('fails as a 502 on an entry with no id rather than reconciling a partial list', async () => {
        const { provider } = providerReturning(page([{ status: 'active' }]))

        const failure = await provider.listSubscriptions().catch((error: unknown) => error)

        expect((failure as CustomError).statusCode).toBe(502)
    })

    it('fails as a 502 when the provider says there are more pages but gives no cursor to continue from', async () => {
        const { provider, fetchImpl } = providerReturning(page([], true))

        const failure = await provider.listSubscriptions().catch((error: unknown) => error)

        expect((failure as CustomError).statusCode).toBe(502)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('fails as a 502 instead of looping when the cursor does not advance', async () => {
        const stuck = page([resource('sub_1')], true)
        const fetchImpl = stubFetch(() => json(stuck))
        const provider = createMorProvider(config, { fetchImpl })

        const failure = await provider.listSubscriptions().catch((error: unknown) => error)

        expect((failure as CustomError).statusCode).toBe(502)
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('refuses a runaway page count instead of looping on it', async () => {
        let n = 0
        const fetchImpl = stubFetch(() => json(page([resource(`sub_${(n += 1)}`)], true)))
        const provider = createMorProvider(config, { fetchImpl })

        const failure = await provider.listSubscriptions().catch((error: unknown) => error)

        expect((failure as CustomError).statusCode).toBe(502)
        expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(501)
    })
})
