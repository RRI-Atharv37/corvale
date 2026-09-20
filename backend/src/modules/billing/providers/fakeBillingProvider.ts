import crypto from 'node:crypto'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import type { BillingProvider, NormalizedBillingEvent } from './billingProvider'

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature'
export const FAKE_WEBHOOK_SECRET = 'whsec_test_secret'

export const signFakePayload = (raw: string, secret: string = FAKE_WEBHOOK_SECRET): string =>
    crypto.createHmac('sha256', secret).update(raw).digest('hex')

export interface FakeProviderCalls {
    verifyWebhook: number
    parseEvent: number
    createCheckoutSession: Array<Record<string, unknown>>
    getPortalUrl: Array<Record<string, unknown>>
}

export interface FakeBillingProviderOptions {
    secret?: string
    signatureHeader?: string
}

const invalidPayload = (): CustomError => new CustomError(ERROR_MESSAGES.BILLING.WEBHOOK_PAYLOAD_INVALID, 400)

const optionalDate = (value: unknown): Date | null | undefined => {
    if (value === undefined) return undefined
    if (value === null) return null
    const date = new Date(value as string)
    if (Number.isNaN(date.getTime())) throw invalidPayload()
    return date
}

/** Test double: the event body is already the normalised event, signed with HMAC-SHA256 over the raw bytes. */
export const createFakeBillingProvider = (
    options: FakeBillingProviderOptions = {}
): { provider: BillingProvider; calls: FakeProviderCalls } => {
    const secret = options.secret ?? FAKE_WEBHOOK_SECRET
    const signatureHeader = options.signatureHeader ?? FAKE_SIGNATURE_HEADER
    const calls: FakeProviderCalls = {
        verifyWebhook: 0,
        parseEvent: 0,
        createCheckoutSession: [],
        getPortalUrl: [],
    }

    const provider: BillingProvider = {
        name: 'fake',
        async createCheckoutSession(input) {
            calls.createCheckoutSession.push({ ...input })
            return { url: `https://fake.test/checkout/${input.planCode}/${input.interval}` }
        },
        async getPortalUrl(input) {
            calls.getPortalUrl.push({ ...input })
            return { url: `https://fake.test/portal/${input.providerCustomerId}` }
        },
        verifyWebhook(rawBody, headers) {
            calls.verifyWebhook += 1
            const provided = headers[signatureHeader]
            if (typeof provided !== 'string' || provided === '') return false
            const a = Buffer.from(provided)
            const b = Buffer.from(signFakePayload(rawBody.toString('utf8'), secret))
            return a.length === b.length && crypto.timingSafeEqual(a, b)
        },
        parseEvent(rawBody) {
            calls.parseEvent += 1
            let parsed: unknown
            try {
                parsed = JSON.parse(rawBody.toString('utf8'))
            } catch {
                throw invalidPayload()
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidPayload()

            const wire = parsed as Record<string, unknown>
            if (typeof wire.providerEventId !== 'string' || wire.providerEventId === '') throw invalidPayload()
            if (typeof wire.type !== 'string' || wire.type === '') throw invalidPayload()
            const occurredAt = optionalDate(wire.occurredAt)
            if (!occurredAt) throw invalidPayload()

            return {
                ...wire,
                occurredAt,
                currentPeriodEnd: optionalDate(wire.currentPeriodEnd),
                trialEndsAt: optionalDate(wire.trialEndsAt),
            } as NormalizedBillingEvent
        },
    }

    return { provider, calls }
}
