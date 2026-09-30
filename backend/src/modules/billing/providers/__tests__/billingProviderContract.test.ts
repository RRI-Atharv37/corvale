import crypto from 'node:crypto'

import { describe, expect, it } from 'vitest'

import type { BillingProvider } from '@modules/billing'
import type { PlanCode } from '@core/billing/constants'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import { createFakeBillingProvider, FAKE_SIGNATURE_HEADER, signFakePayload } from '../fakeBillingProvider'
import { createMorProvider, signCheckoutUserId, type MorConfig } from '../morProvider'

/**
 * M3 - one behavioural contract every `BillingProvider` must satisfy, run against the fake and the
 * real (MoR) adapter. The webhook handler (M3b/M3c) relies on exactly these properties,
 * so an MoR migration is "write an adapter, add a harness here" and nothing else.
 */

interface DeliverySpec {
    type: 'subscription.created' | 'subscription.updated' | 'payment.failed' | 'unknown'
    occurredAt: Date
    providerCustomerId: string
    providerSubscriptionId: string
    userId?: string
    planCode?: PlanCode
}

interface Delivery {
    rawBody: Buffer
    headers: Record<string, string | string[] | undefined>
}

interface ProviderHarness {
    name: string
    provider: BillingProvider
    deliver(spec: DeliverySpec): Delivery
    signedHeaders(rawBody: Buffer): Record<string, string>
}

const MOR_SECRET = 'mor_contract_secret'

const morConfig = (): MorConfig => ({
    apiKey: 'mor_key',
    environment: 'sandbox',
    webhookSecret: MOR_SECRET,
    prices: {
        plus: { monthly: '101', annual: '102' },
        pro: { monthly: '201', annual: '202' },
    },
})

const jsonResponse = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

const morHarness = (): ProviderHarness => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
        const url = String(input)
        if (url.includes('/transactions?')) return jsonResponse({ data: [] })
        if (url.endsWith('/transactions')) return jsonResponse({ data: { checkout: { url: 'https://app.example.test/pay?_ptxn=txn_1' } } })
        if (/\/transactions\/[^/?]+$/.test(url)) {
            return jsonResponse({ data: { id: 'inv_1', details: { totals: { total: '500' }, line_items: [{ id: 'txnitm_1' }] } } })
        }
        if (url.endsWith('/adjustments')) return jsonResponse({ data: { id: 'adj_1', status: 'pending_approval' } })
        if (url.endsWith('/portal-sessions')) {
            return jsonResponse({ data: { urls: { general: { overview: 'https://customer-portal.example.test/p?action=overview' } } } })
        }
        return jsonResponse({ data: { id: '77' } })
    }
    const provider = createMorProvider(morConfig(), { fetchImpl: fetchImpl as typeof fetch })

    const eventTypes: Record<DeliverySpec['type'], string> = {
        'subscription.created': 'subscription.created',
        'subscription.updated': 'subscription.updated',
        'payment.failed': 'transaction.payment_failed',
        unknown: 'customer.updated',
    }
    const prices: Record<PlanCode, string> = { plus: '101', pro: '201' }

    return {
        name: 'mor',
        provider,
        signedHeaders: (rawBody) => {
            const ts = Math.floor(Date.now() / 1000)
            const h1 = crypto.createHmac('sha256', MOR_SECRET).update(`${ts}:`).update(rawBody).digest('hex')
            return { 'paddle-signature': `ts=${ts};h1=${h1}` }
        },
        deliver(spec) {
            const at = spec.occurredAt.toISOString()
            const isTransaction = spec.type === 'payment.failed'
            const body = {
                event_id: `evt_${spec.type}_${spec.occurredAt.getTime()}_${spec.providerSubscriptionId}`,
                event_type: eventTypes[spec.type],
                occurred_at: at,
                notification_id: 'ntf_1',
                data: isTransaction
                    ? { id: 'txn_1', status: 'past_due', customer_id: spec.providerCustomerId, subscription_id: spec.providerSubscriptionId }
                    : {
                          id: spec.providerSubscriptionId,
                          status: 'active',
                          customer_id: spec.providerCustomerId,
                          custom_data: spec.userId ? { user_id: spec.userId, user_sig: signCheckoutUserId(MOR_SECRET, spec.userId) } : null,
                          items: [{ status: 'active', quantity: 1, trial_dates: null, price: { id: prices[spec.planCode ?? 'plus'] } }],
                          current_billing_period: { starts_at: at, ends_at: '2099-01-01T00:00:00.000000Z' },
                          scheduled_change: null,
                      },
            }
            const rawBody = Buffer.from(JSON.stringify(body))
            return { rawBody, headers: this.signedHeaders(rawBody) }
        },
    }
}

const fakeHarness = (): ProviderHarness => {
    const { provider } = createFakeBillingProvider()
    const secret = 'whsec_test_secret'
    return {
        name: 'fake',
        provider,
        signedHeaders: (rawBody) => ({ [FAKE_SIGNATURE_HEADER]: signFakePayload(rawBody.toString('utf8'), secret) }),
        deliver(spec) {
            const rawBody = Buffer.from(
                JSON.stringify({
                    providerEventId: `evt_${spec.type}_${spec.occurredAt.getTime()}_${spec.providerSubscriptionId}`,
                    type: spec.type === 'unknown' ? 'customer.updated' : spec.type,
                    occurredAt: spec.occurredAt.toISOString(),
                    providerCustomerId: spec.providerCustomerId,
                    providerSubscriptionId: spec.providerSubscriptionId,
                    userId: spec.userId,
                    planCode: spec.planCode,
                    status: 'active',
                })
            )
            return { rawBody, headers: this.signedHeaders(rawBody) }
        },
    }
}

const base: DeliverySpec = {
    type: 'subscription.created',
    occurredAt: new Date('2026-03-01T10:00:00.000Z'),
    providerCustomerId: '55',
    providerSubscriptionId: '77',
    userId: '64b7f0c2a1b2c3d4e5f60718',
    planCode: 'pro',
}

describe.each([
    ['fake', fakeHarness],
    ['mor', morHarness],
])('BillingProvider contract: %s', (_name, makeHarness) => {
    const harness = makeHarness()
    const { provider } = harness

    describe('verifyWebhook', () => {
        it('accepts a correctly signed delivery', () => {
            const { rawBody, headers } = harness.deliver(base)

            expect(provider.verifyWebhook(rawBody, headers)).toBe(true)
        })

        it('rejects a delivery with no signature header', () => {
            const { rawBody } = harness.deliver(base)

            expect(provider.verifyWebhook(rawBody, {})).toBe(false)
        })

        it('rejects a signature that was made over different bytes', () => {
            const { rawBody } = harness.deliver(base)
            const other = harness.deliver({ ...base, providerSubscriptionId: '78' })

            expect(provider.verifyWebhook(rawBody, other.headers)).toBe(false)
        })

        it('rejects a body altered after signing', () => {
            const { rawBody, headers } = harness.deliver(base)
            const tampered = Buffer.from(rawBody.toString('utf8').replace('"pro"', '"plus"').replace('55', '56'))

            expect(provider.verifyWebhook(tampered, headers)).toBe(false)
        })

        it('rejects a truncated signature without throwing', () => {
            const { rawBody, headers } = harness.deliver(base)
            const [headerName, value] = Object.entries(headers)[0] as [string, string]

            expect(() => provider.verifyWebhook(rawBody, { [headerName]: value.slice(0, 10) })).not.toThrow()
            expect(provider.verifyWebhook(rawBody, { [headerName]: value.slice(0, 10) })).toBe(false)
        })

        it('rejects an empty and a repeated (array) signature header', () => {
            const { rawBody, headers } = harness.deliver(base)
            const [headerName, value] = Object.entries(headers)[0] as [string, string]

            expect(provider.verifyWebhook(rawBody, { [headerName]: '' })).toBe(false)
            expect(provider.verifyWebhook(rawBody, { [headerName]: [value, value] })).toBe(false)
        })

        it('rejects an empty body', () => {
            const { headers } = harness.deliver(base)

            expect(provider.verifyWebhook(Buffer.alloc(0), headers)).toBe(false)
        })
    })

    describe('parseEvent', () => {
        it('normalises identifiers, plan, status and time', () => {
            const { rawBody } = harness.deliver(base)

            const event = provider.parseEvent(rawBody)

            expect(event.type).toBe('subscription.created')
            expect(event.userId).toBe(base.userId)
            expect(event.providerCustomerId).toBe('55')
            expect(event.providerSubscriptionId).toBe('77')
            expect(event.planCode).toBe('pro')
            expect(event.status).toBe('active')
            expect(event.occurredAt).toBeInstanceOf(Date)
            expect(event.occurredAt.getTime()).toBe(base.occurredAt.getTime())
            expect(typeof event.providerEventId).toBe('string')
            expect(event.providerEventId.length).toBeGreaterThan(0)
        })

        it('gives a redelivered body the same providerEventId (webhook replay is idempotent)', () => {
            const first = provider.parseEvent(harness.deliver(base).rawBody)
            const replay = provider.parseEvent(harness.deliver(base).rawBody)

            expect(replay.providerEventId).toBe(first.providerEventId)
        })

        it('gives distinct events distinct providerEventIds', () => {
            const a = provider.parseEvent(harness.deliver(base).rawBody)
            const b = provider.parseEvent(
                harness.deliver({ ...base, type: 'subscription.updated', occurredAt: new Date('2026-03-02T10:00:00.000Z') }).rawBody
            )

            expect(b.providerEventId).not.toBe(a.providerEventId)
        })

        it('normalises a failed payment', () => {
            const event = provider.parseEvent(harness.deliver({ ...base, type: 'payment.failed', userId: undefined }).rawBody)

            expect(event.type).toBe('payment.failed')
            expect(event.providerSubscriptionId).toBe('77')
            expect(event.providerCustomerId).toBe('55')
        })

        it('passes an event type it does not know through unchanged rather than throwing', () => {
            const event = provider.parseEvent(harness.deliver({ ...base, type: 'unknown' }).rawBody)

            expect(typeof event.type).toBe('string')
            expect(event.type).not.toBe('subscription.created')
            expect(event.providerEventId).toBeTruthy()
        })

        it.each([['not json'], ['[]'], ['null'], ['{}'], ['']])('rejects a malformed body (%j) as a 400 payload error', (raw) => {
            let thrown: unknown
            try {
                provider.parseEvent(Buffer.from(raw))
            } catch (error) {
                thrown = error
            }

            expect(thrown).toBeInstanceOf(CustomError)
            expect((thrown as CustomError).statusCode).toBe(400)
            expect((thrown as CustomError).message).toBe(ERROR_MESSAGES.BILLING.WEBHOOK_PAYLOAD_INVALID)
        })
    })

    describe('hosted pages', () => {
        it('createCheckoutSession returns a URL', async () => {
            const session = await provider.createCheckoutSession({
                userId: base.userId as string,
                email: 'someone@example.com',
                planCode: 'plus',
                interval: 'monthly',
            })

            expect(session.url).toMatch(/^https:\/\//)
        })

        it('getPortalUrl returns a URL', async () => {
            const portal = await provider.getPortalUrl({ providerCustomerId: '55' })

            expect(portal.url).toMatch(/^https:\/\//)
        })
    })

    describe('account management (M6)', () => {
        it('listInvoices returns an array, never a partial or a raw provider body', async () => {
            const invoices = await provider.listInvoices({ providerSubscriptionId: '77' })

            expect(Array.isArray(invoices)).toBe(true)
        })

        it('changePlan, cancelSubscription and resumeSubscription resolve without returning provider state', async () => {
            await expect(provider.changePlan({ providerSubscriptionId: '77', planCode: 'pro', interval: 'annual' })).resolves.toBeUndefined()
            await expect(provider.cancelSubscription({ providerSubscriptionId: '77' })).resolves.toBeUndefined()
            await expect(provider.cancelSubscription({ providerSubscriptionId: '77', immediate: true })).resolves.toBeUndefined()
            await expect(provider.resumeSubscription({ providerSubscriptionId: '77' })).resolves.toBeUndefined()
        })
    })

    describe('provider actions (M7.5)', () => {
        it('getSubscriptionSnapshot resolves to a snapshot or null, never throwing for a known id', async () => {
            const snapshot = await provider.getSubscriptionSnapshot({ providerSubscriptionId: '77' })

            expect(snapshot === null || typeof snapshot === 'object').toBe(true)
        })

        it('refundInvoice resolves without returning provider state - the resulting status arrives on a webhook', async () => {
            await expect(provider.refundInvoice({ providerInvoiceId: 'inv_1', amountMinor: 500 })).resolves.toBeUndefined()
        })
    })
})
