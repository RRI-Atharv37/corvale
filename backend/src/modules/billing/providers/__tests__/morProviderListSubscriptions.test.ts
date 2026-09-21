import { describe, expect, it, vi } from 'vitest'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import { createMorProvider, type MorConfig } from '../morProvider'

/** M3d - the adapter's read side: every subscription of the store, reduced to what reconciliation compares. */

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

const resource = (id: string, attributes: Record<string, unknown> = {}) => ({
    type: 'subscriptions',
    id,
    attributes: {
        store_id: 9,
        customer_id: 55,
        variant_id: 201,
        status: 'active',
        cancelled: false,
        user_name: 'Ada Lovelace',
        user_email: 'ada@example.com',
        trial_ends_at: null,
        renews_at: '2026-04-01T00:00:00.000000Z',
        ends_at: null,
        created_at: '2026-03-01T09:00:00.000000Z',
        updated_at: '2026-03-01T10:00:00.000000Z',
        ...attributes,
    },
})

const page = (data: unknown[], number = 1, lastPage = 1) => ({ data, meta: { page: { currentPage: number, lastPage } } })

const providerReturning = (...pages: unknown[]) => {
    const fetchImpl = stubFetch((url) => {
        const requested = Number(new URL(url).searchParams.get('page[number]') ?? '1')
        return json(pages[requested - 1] ?? page([]))
    })
    return { provider: createMorProvider(config, { fetchImpl }), fetchImpl }
}

describe('listSubscriptions', () => {
    it('asks for this store only, a page at a time, authenticated with the API key', async () => {
        const { provider, fetchImpl } = providerReturning(page([]))

        await provider.listSubscriptions()

        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
        const requested = new URL(url)
        expect(requested.pathname).toBe('/v1/subscriptions')
        expect(requested.searchParams.get('filter[store_id]')).toBe('9')
        expect(requested.searchParams.get('page[number]')).toBe('1')
        expect(Number(requested.searchParams.get('page[size]'))).toBeGreaterThan(0)
        expect(init.method).toBe('GET')
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer mor_live_key')
    })

    it('normalises ids, plan, status, dates and time', async () => {
        const { provider } = providerReturning(page([resource('77', { trial_ends_at: '2026-03-15T00:00:00.000000Z' })]))

        const [snapshot] = await provider.listSubscriptions()

        expect(snapshot).toEqual({
            providerSubscriptionId: '77',
            providerCustomerId: '55',
            planCode: 'pro',
            status: 'active',
            currentPeriodEnd: new Date('2026-04-01T00:00:00.000Z'),
            trialEndsAt: new Date('2026-03-15T00:00:00.000Z'),
            cancelAtPeriodEnd: false,
            updatedAt: new Date('2026-03-01T10:00:00.000Z'),
        })
    })

    it('never carries an email or a name', async () => {
        const { provider } = providerReturning(page([resource('77')]))

        const snapshots = await provider.listSubscriptions()

        expect(JSON.stringify(snapshots)).not.toMatch(/ada@example\.com|Ada Lovelace/)
    })

    it('follows the pages until the last one', async () => {
        const { provider, fetchImpl } = providerReturning(
            page([resource('1')], 1, 3),
            page([resource('2')], 2, 3),
            page([resource('3')], 3, 3)
        )

        const snapshots = await provider.listSubscriptions()

        expect(snapshots.map((snapshot) => snapshot.providerSubscriptionId)).toEqual(['1', '2', '3'])
        expect(fetchImpl).toHaveBeenCalledTimes(3)
    })

    it('treats a response with no page metadata as the only page', async () => {
        const { provider, fetchImpl } = providerReturning({ data: [resource('1')] })

        const snapshots = await provider.listSubscriptions()

        expect(snapshots).toHaveLength(1)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('maps a cancelled subscription that still has time left to active + cancelAtPeriodEnd, ending at ends_at', async () => {
        const { provider } = providerReturning(
            page([
                resource('77', {
                    status: 'cancelled',
                    cancelled: true,
                    renews_at: null,
                    ends_at: '2099-01-01T00:00:00.000000Z',
                    updated_at: '2026-03-01T10:00:00.000000Z',
                }),
            ])
        )

        const [snapshot] = await provider.listSubscriptions()

        expect(snapshot.status).toBe('active')
        expect(snapshot.cancelAtPeriodEnd).toBe(true)
        expect(snapshot.currentPeriodEnd).toEqual(new Date('2099-01-01T00:00:00.000Z'))
    })

    it('maps an expired subscription to cancelled', async () => {
        const { provider } = providerReturning(page([resource('77', { status: 'expired', cancelled: true })]))

        const [snapshot] = await provider.listSubscriptions()

        expect(snapshot.status).toBe('cancelled')
    })

    it('leaves the status out for a state that maps to none (paused) rather than guessing', async () => {
        const { provider } = providerReturning(page([resource('77', { status: 'paused' })]))

        const [snapshot] = await provider.listSubscriptions()

        expect(snapshot.status).toBeUndefined()
    })

    it('leaves the plan out for a variant that is not in the configured catalogue', async () => {
        const { provider } = providerReturning(page([resource('77', { variant_id: 999 })]))

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
        const { provider } = providerReturning(page([{ type: 'subscriptions', attributes: {} }]))

        const failure = await provider.listSubscriptions().catch((error: unknown) => error)

        expect((failure as CustomError).statusCode).toBe(502)
    })

    it('refuses a runaway page count instead of looping on it', async () => {
        const { provider, fetchImpl } = providerReturning(page([resource('1')], 1, 1_000_000))

        const failure = await provider.listSubscriptions().catch((error: unknown) => error)

        expect((failure as CustomError).statusCode).toBe(502)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })
})
