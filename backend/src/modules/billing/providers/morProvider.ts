import crypto from 'node:crypto'

import { PLAN_CODES, type PlanCode, type SubscriptionStatus } from '@core/billing/constants'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { logger } from '@infra/observability/logger'

import {
    BILLING_INTERVALS,
    type BillingProvider,
    type KnownBillingEventType,
    type NormalizedBillingEvent,
    type ProviderInvoice,
    type ProviderInvoiceStatus,
    type ProviderSubscriptionSnapshot,
} from './billingProvider'

export type MorEnvironment = 'sandbox' | 'production'

export type MorPrices = Record<PlanCode, Record<(typeof BILLING_INTERVALS)[number], string>>

export interface MorConfig {
    apiKey: string
    environment: MorEnvironment
    webhookSecret: string
    prices: MorPrices
}

export interface MorOptions {
    fetchImpl?: typeof fetch
    apiBase?: string
    timeoutMs?: number
}

const PADDLE_SANDBOX_API_BASE = 'https://sandbox-api.paddle.com'
const PADDLE_PRODUCTION_API_BASE = 'https://api.paddle.com'
const DEFAULT_TIMEOUT_MS = 10_000
const JSON_CONTENT = 'application/json'
const SIGNATURE_HEADER = 'paddle-signature'
const SIGNATURE_TOLERANCE_SECONDS = 5
const LIST_PAGE_SIZE = 200
const TRANSACTION_PAGE_SIZE = 30
const MAX_LIST_PAGES = 500
const INVOICE_STATUSES = 'billed,paid,completed,past_due,canceled'
const PRORATION_BILLING_MODE = 'prorated_immediately'
const REFUND_REASON = 'Refund requested by Corvale staff'

const SETTINGS = {
    apiKey: 'MOR_API_KEY',
    environment: 'MOR_ENVIRONMENT',
    webhookSecret: 'MOR_WEBHOOK_SECRET',
    prices: 'MOR_PRICES',
} as const

const asPriceId = (value: unknown): string | undefined => {
    if (typeof value === 'string') {
        const id = value.trim()
        return id === '' ? undefined : id
    }
    if (typeof value === 'number' && Number.isInteger(value)) return String(value)
    return undefined
}

const planEntry = (parsed: Record<string, unknown>, plan: PlanCode): Record<string, unknown> | undefined => {
    const nested = parsed[plan]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested as Record<string, unknown>

    const flat = Object.fromEntries(BILLING_INTERVALS.map((interval) => [interval, parsed[`${plan}_${interval}`]]))
    return BILLING_INTERVALS.every((interval) => asPriceId(flat[interval]) !== undefined) ? flat : undefined
}

const parsePrices = (raw: string): MorPrices => {
    const invalid = (): Error =>
        new Error(
            `${SETTINGS.prices} must be JSON like {"plus":{"monthly":"<id>","annual":"<id>"},"pro":{...}} with a distinct price id for every plan and interval`
        )

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw invalid()
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid()

    const record = parsed as Record<string, unknown>
    const seen = new Set<string>()
    const prices = {} as MorPrices
    for (const plan of PLAN_CODES) {
        const entry = planEntry(record, plan)
        if (!entry) throw invalid()
        prices[plan] = {} as MorPrices[PlanCode]
        for (const interval of BILLING_INTERVALS) {
            const id = asPriceId(entry[interval])
            if (!id || seen.has(id)) throw invalid()
            seen.add(id)
            prices[plan][interval] = id
        }
    }
    return prices
}

const asEnvironment = (value: string): MorEnvironment => {
    if (value !== 'sandbox' && value !== 'production') {
        throw new Error(`${SETTINGS.environment} must be "sandbox" or "production"`)
    }
    return value
}

export const morConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): MorConfig => {
    const read = (key: string): string => (env[key] ?? '').trim()
    const missing = Object.values(SETTINGS).filter((key) => read(key) === '')
    if (missing.length > 0) {
        throw new Error(`Missing billing provider settings: ${missing.join(', ')}`)
    }

    return {
        apiKey: read(SETTINGS.apiKey),
        environment: asEnvironment(read(SETTINGS.environment)),
        webhookSecret: read(SETTINGS.webhookSecret),
        prices: parsePrices(read(SETTINGS.prices)),
    }
}

const EVENT_TYPES: Readonly<Record<string, KnownBillingEventType>> = {
    'subscription.created': 'subscription.created',
    'subscription.updated': 'subscription.updated',
    'subscription.activated': 'subscription.updated',
    'subscription.trialing': 'subscription.updated',
    'subscription.past_due': 'subscription.updated',
    'subscription.paused': 'subscription.updated',
    'subscription.resumed': 'subscription.updated',
    'subscription.canceled': 'subscription.deleted',
    'transaction.completed': 'payment.succeeded',
    'transaction.payment_failed': 'payment.failed',
}

// Paddle has no dispute entity: a chargeback arrives as an adjustment. Warnings and reversals are recorded but never mapped, so they cannot revoke access or count as a refund.
// A refund is only real once Paddle approves it - it starts as pending_approval and can be rejected - so it is counted on the event that carries `approved`; a chargeback opens a dispute once, on creation.
const adjustmentEventType = (eventType: string, action: string | undefined, status: string | undefined): KnownBillingEventType | undefined => {
    const created = eventType === 'adjustment.created'
    if (!created && eventType !== 'adjustment.updated') return undefined
    if ((action === 'refund' || action === 'credit') && status === 'approved') return 'refund.issued'
    return created && action === 'chargeback' ? 'dispute.opened' : undefined
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value)

const asId = (value: unknown): string | undefined =>
    typeof value === 'string' && value !== '' ? value : typeof value === 'number' ? String(value) : undefined

const asDate = (value: unknown): Date | undefined => {
    if (typeof value !== 'string') return undefined
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date
}

const asMinorUnits = (value: unknown): number | undefined => {
    const amount = typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : value
    return typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0 ? amount : undefined
}

const compact = (source: Json): Json => Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined))

const payloadInvalid = (): CustomError => new CustomError(ERROR_MESSAGES.BILLING.WEBHOOK_PAYLOAD_INVALID, 400)
const requestFailed = (): CustomError => new CustomError(ERROR_MESSAGES.BILLING.PROVIDER_REQUEST_FAILED, 502)

const parseSignatureHeader = (header: string): { timestamp: string; signatures: string[] } | null => {
    let timestamp: string | undefined
    const signatures: string[] = []
    for (const part of header.split(';')) {
        const separator = part.indexOf('=')
        if (separator === -1) return null
        const key = part.slice(0, separator).trim()
        const value = part.slice(separator + 1).trim()

        if (key === 'ts') {
            if (timestamp !== undefined || !/^\d{1,12}$/.test(value)) return null
            timestamp = value
        } else if (key === 'h1') {
            if (!/^(?:[0-9a-f]{2})+$/i.test(value)) return null
            signatures.push(value)
        }
    }
    return timestamp !== undefined && signatures.length > 0 ? { timestamp, signatures } : null
}

const isHttps = (value: unknown): value is string => {
    if (typeof value !== 'string') return false
    try {
        return new URL(value).protocol === 'https:'
    } catch {
        return false
    }
}

export const createMorProvider = (
    config: MorConfig,
    options: MorOptions = {}
): BillingProvider => {
    const fetchImpl = options.fetchImpl ?? fetch
    const apiBase = options.apiBase ?? (config.environment === 'production' ? PADDLE_PRODUCTION_API_BASE : PADDLE_SANDBOX_API_BASE)
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const planByPrice = new Map<string, PlanCode>()
    const intervalByPrice = new Map<string, (typeof BILLING_INTERVALS)[number]>()
    for (const plan of PLAN_CODES) {
        for (const interval of BILLING_INTERVALS) {
            const variant = config.prices[plan][interval]
            planByPrice.set(variant, plan)
            intervalByPrice.set(variant, interval)
        }
    }

    const call = async (operation: string, path: string, init: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }): Promise<Json> => {
        let response: Response
        try {
            response = await fetchImpl(`${apiBase}${path}`, {
                method: init.method,
                headers: {
                    Accept: JSON_CONTENT,
                    Authorization: `Bearer ${config.apiKey}`,
                    ...(init.body === undefined ? {} : { 'Content-Type': JSON_CONTENT }),
                },
                body: init.body === undefined ? undefined : JSON.stringify(init.body),
                signal: AbortSignal.timeout(timeoutMs),
            })
        } catch (error) {
            logger.error('Billing provider request failed', { operation, reason: (error as Error).name })
            throw requestFailed()
        }

        if (!response.ok) {
            logger.error('Billing provider rejected a request', { operation, status: response.status })
            throw requestFailed()
        }

        try {
            const body: unknown = await response.json()
            if (isObject(body)) return body
        } catch {
            // falls through to the failure below
        }
        logger.error('Billing provider returned an unreadable response', { operation })
        throw requestFailed()
    }

    const dataOf = (body: Json): Json => (isObject(body.data) ? body.data : {})

    const mapSubscriptionStatus = (providerStatus: unknown): SubscriptionStatus | undefined => {
        switch (providerStatus) {
            case 'trialing':
                return 'trialing'
            case 'active':
                return 'active'
            case 'past_due':
                return 'past_due'
            case 'canceled':
                return 'cancelled'
            default:
                return undefined
        }
    }

    const readSubscription = (data: Json) => {
        const items = Array.isArray(data.items) ? data.items.filter(isObject) : []
        const priceIds = items.map((item) => (isObject(item.price) ? asId(item.price.id) : undefined))
        const priceId = priceIds.find((id) => id !== undefined && planByPrice.has(id)) ?? priceIds.find((id) => id !== undefined)
        const trialEndsAt = items
            .map((item) => (isObject(item.trial_dates) ? asDate(item.trial_dates.ends_at) : undefined))
            .find((date) => date !== undefined)
        const scheduledChange = isObject(data.scheduled_change) ? data.scheduled_change : undefined
        const scheduledChangeAction = typeof scheduledChange?.action === 'string' ? scheduledChange.action : undefined
        const cancelAtPeriodEnd = scheduledChangeAction === 'cancel'
        const billingPeriod = isObject(data.current_billing_period) ? data.current_billing_period : undefined
        const currentPeriodEnd = cancelAtPeriodEnd
            ? (asDate(scheduledChange?.effective_at) ?? asDate(billingPeriod?.ends_at))
            : (asDate(billingPeriod?.ends_at) ?? asDate(data.next_billed_at))

        return {
            providerCustomerId: asId(data.customer_id),
            priceId,
            trialEndsAt,
            scheduledChangeAction,
            cancelAtPeriodEnd,
            currentPeriodEnd,
        }
    }

    const toInvoice = (entry: unknown): ProviderInvoice | null => {
        if (!isObject(entry)) return null
        const id = asId(entry.id)
        const issuedAt = asDate(entry.billed_at) ?? asDate(entry.created_at)
        if (!id || !issuedAt) return null

        const totals = isObject(entry.details) && isObject(entry.details.totals) ? entry.details.totals : undefined
        const adjustments = isObject(entry.adjustments_totals) ? entry.adjustments_totals : undefined
        const breakdown = adjustments && isObject(adjustments.breakdown) ? adjustments.breakdown : undefined
        const refunded = (asMinorUnits(breakdown?.refund) ?? 0) > 0

        const providerStatus = entry.status
        const status: ProviderInvoiceStatus = refunded
            ? 'refunded'
            : providerStatus === 'completed' || providerStatus === 'paid'
              ? 'paid'
              : providerStatus === 'canceled'
                ? 'void'
                : 'pending'

        return {
            id,
            issuedAt,
            total: asMinorUnits(totals?.total) ?? 0,
            currency: typeof entry.currency_code === 'string' ? entry.currency_code : 'USD',
            status,
            url: null,
        }
    }

    const subscriptionPath = (providerSubscriptionId: string): string =>
        `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`

    const toSnapshot = (entry: unknown): ProviderSubscriptionSnapshot => {
        const providerSubscriptionId = isObject(entry) ? asId(entry.id) : undefined
        if (!isObject(entry) || !providerSubscriptionId) {
            logger.error('Billing provider returned a subscription with no id', { operation: 'listSubscriptions' })
            throw requestFailed()
        }

        const facts = readSubscription(entry)
        return compact({
            providerSubscriptionId,
            providerCustomerId: facts.providerCustomerId,
            planCode: facts.priceId ? planByPrice.get(facts.priceId) : undefined,
            status: mapSubscriptionStatus(entry.status),
            currentPeriodEnd: facts.currentPeriodEnd,
            trialEndsAt: facts.trialEndsAt,
            cancelAtPeriodEnd: facts.cancelAtPeriodEnd,
            updatedAt: asDate(entry.updated_at) ?? asDate(entry.created_at) ?? new Date(0),
        }) as unknown as ProviderSubscriptionSnapshot
    }

    return {
        name: 'mor',

        // Unlike `call()`, a 404 here means "no longer at the provider", not a failure - an admin resync must tell those apart.
        async getSubscriptionSnapshot({ providerSubscriptionId }) {
            const operation = 'getSubscriptionSnapshot'
            let response: Response
            try {
                response = await fetchImpl(`${apiBase}${subscriptionPath(providerSubscriptionId)}`, {
                    method: 'GET',
                    headers: { Accept: JSON_CONTENT, Authorization: `Bearer ${config.apiKey}` },
                    signal: AbortSignal.timeout(timeoutMs),
                })
            } catch (error) {
                logger.error('Billing provider request failed', { operation, reason: (error as Error).name })
                throw requestFailed()
            }
            if (response.status === 404) return null
            if (!response.ok) {
                logger.error('Billing provider rejected a request', { operation, status: response.status })
                throw requestFailed()
            }

            let body: unknown
            try {
                body = await response.json()
            } catch {
                body = undefined
            }
            if (!isObject(body) || !isObject(body.data)) {
                logger.error('Billing provider returned an unreadable response', { operation })
                throw requestFailed()
            }
            return toSnapshot(body.data)
        },

        async listSubscriptions() {
            const snapshots: ProviderSubscriptionSnapshot[] = []
            let after: string | undefined
            let pages = 0

            for (;;) {
                pages += 1
                if (pages > MAX_LIST_PAGES) {
                    logger.error('Billing provider paged past the sane limit', { operation: 'listSubscriptions', pages })
                    throw requestFailed()
                }

                const query = new URLSearchParams({ per_page: String(LIST_PAGE_SIZE), order_by: 'id[ASC]' })
                if (after !== undefined) query.set('after', after)
                const body = await call('listSubscriptions', `/subscriptions?${query.toString()}`, { method: 'GET' })

                const entries = Array.isArray(body.data) ? body.data : []
                snapshots.push(...entries.map(toSnapshot))

                const pagination = isObject(body.meta) && isObject(body.meta.pagination) ? body.meta.pagination : undefined
                if (pagination?.has_more !== true) return snapshots

                const last: unknown = entries[entries.length - 1]
                const cursor = isObject(last) ? asId(last.id) : undefined
                if (!cursor || cursor === after) {
                    logger.error('Billing provider reported more pages but no usable cursor', { operation: 'listSubscriptions' })
                    throw requestFailed()
                }
                after = cursor
            }
        },

        // Links are left null: Paddle's invoice PDF link is a separate call per transaction and expires in an hour; the customer portal carries the full history.
        async listInvoices({ providerSubscriptionId }) {
            const query = new URLSearchParams({
                subscription_id: providerSubscriptionId,
                status: INVOICE_STATUSES,
                include: 'adjustments_totals',
                order_by: 'created_at[DESC]',
                per_page: String(TRANSACTION_PAGE_SIZE),
            })
            const body = await call('listInvoices', `/transactions?${query.toString()}`, { method: 'GET' })

            const entries = Array.isArray(body.data) ? body.data : []
            return entries
                .map(toInvoice)
                .filter((invoice): invoice is ProviderInvoice => invoice !== null)
                .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
        },

        async changePlan({ providerSubscriptionId, planCode, interval }) {
            await call('changePlan', subscriptionPath(providerSubscriptionId), {
                method: 'PATCH',
                body: {
                    items: [{ price_id: config.prices[planCode][interval], quantity: 1 }],
                    proration_billing_mode: PRORATION_BILLING_MODE,
                },
            })
        },

        async cancelSubscription({ providerSubscriptionId, immediate }) {
            await call('cancelSubscription', `${subscriptionPath(providerSubscriptionId)}/cancel`, {
                method: 'POST',
                body: { effective_from: immediate === true ? 'immediately' : 'next_billing_period' },
            })
        },

        // A canceled subscription can never be reinstated; what this undoes is a cancel still scheduled for the period end.
        async resumeSubscription({ providerSubscriptionId }) {
            await call('resumeSubscription', subscriptionPath(providerSubscriptionId), {
                method: 'PATCH',
                body: { scheduled_change: null },
            })
        },

        // Ask-only, like the calls above: the refund's approval arrives on the adjustment.updated webhook. A refund below the total needs the transaction's one line item to point at, hence the lookup.
        async refundInvoice({ providerInvoiceId, amountMinor }) {
            if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
                logger.error('Billing refund refused: amount is not a positive whole number of minor units', { operation: 'refundInvoice' })
                throw requestFailed()
            }

            const transaction = dataOf(await call('refundInvoice', `/transactions/${encodeURIComponent(providerInvoiceId)}`, { method: 'GET' }))
            const details = isObject(transaction.details) ? transaction.details : {}
            const total = asMinorUnits(isObject(details.totals) ? details.totals.total : undefined)
            if (total === undefined || amountMinor > total) {
                logger.error('Billing refund refused: amount exceeds the transaction total or the total is unknown', { operation: 'refundInvoice' })
                throw requestFailed()
            }

            const base = { action: 'refund', transaction_id: providerInvoiceId, reason: REFUND_REASON }
            if (amountMinor === total) {
                await call('refundInvoice', '/adjustments', { method: 'POST', body: { ...base, type: 'full' } })
                return
            }

            const lineItems = Array.isArray(details.line_items) ? details.line_items.filter(isObject) : []
            const itemId = lineItems.length === 1 ? asId(lineItems[0].id) : undefined
            if (!itemId) {
                logger.error('Billing refund refused: a partial refund needs exactly one line item', { operation: 'refundInvoice' })
                throw requestFailed()
            }
            await call('refundInvoice', '/adjustments', {
                method: 'POST',
                body: { ...base, type: 'partial', items: [{ item_id: itemId, type: 'partial', amount: String(amountMinor) }] },
            })
        },

        // The payment link is the account's default payment link plus `?_ptxn=<id>`; it only works once that page runs Paddle.js, and Paddle returns no link until a default one is approved.
        async createCheckoutSession({ userId, planCode, interval }) {
            const body = {
                items: [{ price_id: config.prices[planCode][interval], quantity: 1 }],
                custom_data: { user_id: userId },
            }

            const url = dataOf(await call('createCheckoutSession', '/transactions', { method: 'POST', body })).checkout
            const link = isObject(url) ? url.url : undefined
            if (!isHttps(link)) throw requestFailed()
            return { url: link }
        },

        async getPortalUrl({ providerCustomerId }) {
            const session = dataOf(
                await call('getPortalUrl', `/customers/${encodeURIComponent(providerCustomerId)}/portal-sessions`, { method: 'POST', body: {} })
            )
            const urls = session.urls
            const general = isObject(urls) ? urls.general : undefined
            const url = isObject(general) ? general.overview : undefined
            if (!isHttps(url)) throw requestFailed()
            return { url }
        },

        verifyWebhook(rawBody, headers) {
            const provided = headers[SIGNATURE_HEADER]
            if (typeof provided !== 'string' || rawBody.length === 0) return false

            const parsed = parseSignatureHeader(provided)
            if (!parsed) return false

            const ageSeconds = Math.abs(Date.now() / 1000 - Number(parsed.timestamp))
            if (!Number.isFinite(ageSeconds) || ageSeconds > SIGNATURE_TOLERANCE_SECONDS) return false

            const expected = crypto
                .createHmac('sha256', config.webhookSecret)
                .update(`${parsed.timestamp}:`)
                .update(rawBody)
                .digest()

            return parsed.signatures.reduce((matched, candidate) => {
                const signature = Buffer.from(candidate, 'hex')
                return (signature.length === expected.length && crypto.timingSafeEqual(signature, expected)) || matched
            }, false)
        },

        parseEvent(rawBody): NormalizedBillingEvent {
            let root: unknown
            try {
                root = JSON.parse(rawBody.toString('utf8'))
            } catch {
                throw payloadInvalid()
            }
            if (!isObject(root) || !isObject(root.data)) throw payloadInvalid()
            const providerEventId = typeof root.event_id === 'string' && root.event_id !== '' ? root.event_id : undefined
            const eventType = root.event_type
            if (!providerEventId || typeof eventType !== 'string' || eventType === '') throw payloadInvalid()

            const data = root.data
            const isSubscriptionResource = eventType.startsWith('subscription.')
            const isAdjustment = eventType.startsWith('adjustment.')
            const adjustmentAction = isAdjustment && typeof data.action === 'string' ? data.action : undefined
            const providerStatus = typeof data.status === 'string' ? data.status : undefined
            const mappedType = isAdjustment ? adjustmentEventType(eventType, adjustmentAction, providerStatus) : EVENT_TYPES[eventType]

            const occurredAt = asDate(root.occurred_at)
            if (!occurredAt && mappedType) throw payloadInvalid()

            const providerSubscriptionId = isSubscriptionResource ? asId(data.id) : asId(data.subscription_id)
            const { providerCustomerId, priceId, trialEndsAt, scheduledChangeAction, cancelAtPeriodEnd, currentPeriodEnd } = readSubscription(data)
            const totals = isObject(data.totals) ? data.totals : isObject(data.details) && isObject(data.details.totals) ? data.details.totals : undefined

            const payload = compact({
                providerEventName: eventType,
                providerCustomerId,
                providerSubscriptionId,
                providerStatus,
                priceId,
                scheduledChangeAction,
                currentPeriodEnd: isSubscriptionResource ? currentPeriodEnd?.toISOString() : undefined,
                trialEndsAt: trialEndsAt?.toISOString(),
                adjustmentAction,
                origin: typeof data.origin === 'string' ? data.origin : undefined,
                total: asMinorUnits(totals?.total),
                currency: typeof data.currency_code === 'string' ? data.currency_code : undefined,
            })

            if (!mappedType) {
                return { providerEventId, type: eventType, occurredAt: occurredAt ?? new Date(), payload }
            }

            const event: NormalizedBillingEvent = {
                providerEventId,
                type: mappedType,
                occurredAt: occurredAt as Date,
                providerCustomerId,
                providerSubscriptionId,
                payload,
            }

            if (isSubscriptionResource) {
                const customData = data.custom_data
                event.userId = isObject(customData) && typeof customData.user_id === 'string' ? customData.user_id : undefined
                event.planCode = priceId ? planByPrice.get(priceId) : undefined
                event.interval = priceId ? (intervalByPrice.get(priceId) ?? null) : undefined
                event.status = eventType === 'subscription.canceled' ? 'cancelled' : mapSubscriptionStatus(data.status)
                event.cancelAtPeriodEnd = cancelAtPeriodEnd
                event.currentPeriodEnd = currentPeriodEnd
                event.trialEndsAt = trialEndsAt
            }

            return event
        },
    }
}
