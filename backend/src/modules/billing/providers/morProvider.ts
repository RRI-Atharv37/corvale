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

export type MorVariants = Record<PlanCode, Record<(typeof BILLING_INTERVALS)[number], string>>

export interface MorConfig {
    apiKey: string
    storeId: string
    webhookSecret: string
    variants: MorVariants
}

export interface MorOptions {
    fetchImpl?: typeof fetch
    apiBase?: string
    timeoutMs?: number
}

const DEFAULT_API_BASE = 'https://api.lemonsqueezy.com'
const DEFAULT_TIMEOUT_MS = 10_000
const JSON_API = 'application/vnd.api+json'
const SIGNATURE_HEADER = 'x-signature'
const LIST_PAGE_SIZE = 100
const INVOICE_PAGE_SIZE = 50
const MAX_LIST_PAGES = 500

const SETTINGS = {
    apiKey: 'MOR_API_KEY',
    storeId: 'MOR_STORE_ID',
    webhookSecret: 'MOR_WEBHOOK_SECRET',
    variants: 'MOR_VARIANTS',
} as const

const parseVariants = (raw: string): MorVariants => {
    const invalid = (): Error =>
        new Error(
            `${SETTINGS.variants} must be JSON like {"plus":{"monthly":"<id>","annual":"<id>"},"pro":{...}} with a distinct variant id for every plan and interval`
        )

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw invalid()
    }
    if (!parsed || typeof parsed !== 'object') throw invalid()

    const seen = new Set<string>()
    const variants = {} as MorVariants
    for (const plan of PLAN_CODES) {
        const entry = (parsed as Record<string, unknown>)[plan]
        if (!entry || typeof entry !== 'object') throw invalid()
        variants[plan] = {} as MorVariants[PlanCode]
        for (const interval of BILLING_INTERVALS) {
            const id = (entry as Record<string, unknown>)[interval]
            if (typeof id !== 'string' || id.trim() === '' || seen.has(id)) throw invalid()
            seen.add(id)
            variants[plan][interval] = id
        }
    }
    return variants
}

export const morConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): MorConfig => {
    const read = (key: string): string => (env[key] ?? '').trim()
    const missing = Object.values(SETTINGS).filter((key) => read(key) === '')
    if (missing.length > 0) {
        throw new Error(`Missing billing provider settings: ${missing.join(', ')}`)
    }

    return {
        apiKey: read(SETTINGS.apiKey),
        storeId: read(SETTINGS.storeId),
        webhookSecret: read(SETTINGS.webhookSecret),
        variants: parseVariants(read(SETTINGS.variants)),
    }
}

const EVENT_TYPES: Readonly<Record<string, KnownBillingEventType>> = {
    subscription_created: 'subscription.created',
    subscription_updated: 'subscription.updated',
    subscription_resumed: 'subscription.updated',
    subscription_unpaused: 'subscription.updated',
    subscription_paused: 'subscription.updated',
    subscription_cancelled: 'subscription.updated',
    subscription_expired: 'subscription.deleted',
    subscription_payment_success: 'payment.succeeded',
    subscription_payment_recovered: 'payment.succeeded',
    subscription_payment_failed: 'payment.failed',
    subscription_payment_refunded: 'refund.issued',
    order_refunded: 'refund.issued',
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

const compact = (source: Json): Json => Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined))

const payloadInvalid = (): CustomError => new CustomError(ERROR_MESSAGES.BILLING.WEBHOOK_PAYLOAD_INVALID, 400)
const requestFailed = (): CustomError => new CustomError(ERROR_MESSAGES.BILLING.PROVIDER_REQUEST_FAILED, 502)

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
    const apiBase = options.apiBase ?? DEFAULT_API_BASE
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const planByVariant = new Map<string, PlanCode>()
    const intervalByVariant = new Map<string, (typeof BILLING_INTERVALS)[number]>()
    for (const plan of PLAN_CODES) {
        for (const interval of BILLING_INTERVALS) {
            const variant = config.variants[plan][interval]
            planByVariant.set(variant, plan)
            intervalByVariant.set(variant, interval)
        }
    }

    const call = async (operation: string, path: string, init: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }): Promise<Json> => {
        let response: Response
        try {
            response = await fetchImpl(`${apiBase}${path}`, {
                method: init.method,
                headers: {
                    Accept: JSON_API,
                    Authorization: `Bearer ${config.apiKey}`,
                    ...(init.body === undefined ? {} : { 'Content-Type': JSON_API }),
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

    const attributesOf = (body: Json): Json => {
        const data = body.data
        return isObject(data) && isObject(data.attributes) ? data.attributes : {}
    }

    const mapStatus = (providerStatus: unknown, endsAt: Date | undefined, occurredAt: Date): SubscriptionStatus | undefined => {
        switch (providerStatus) {
            case 'on_trial':
                return 'trialing'
            case 'active':
                return 'active'
            case 'past_due':
            case 'unpaid':
                return 'past_due'
            case 'expired':
                return 'cancelled'
            case 'cancelled':
                return endsAt && endsAt.getTime() > occurredAt.getTime() ? 'active' : 'cancelled'
            default:
                return undefined
        }
    }

    const lastPageOf = (body: Json): number => {
        const meta = body.meta
        const pageMeta = isObject(meta) ? meta.page : undefined
        const lastPage = isObject(pageMeta) ? pageMeta.lastPage : undefined
        return typeof lastPage === 'number' && Number.isInteger(lastPage) && lastPage >= 1 ? lastPage : 1
    }

    const toInvoice = (entry: unknown): ProviderInvoice | null => {
        if (!isObject(entry)) return null
        const id = asId(entry.id)
        const attributes = isObject(entry.attributes) ? entry.attributes : {}
        const issuedAt = asDate(attributes.created_at)
        if (!id || !issuedAt) return null

        const urls = isObject(attributes.urls) ? attributes.urls : {}
        const providerStatus = attributes.status
        const status: ProviderInvoiceStatus =
            attributes.refunded === true || providerStatus === 'refunded' || providerStatus === 'partial_refund'
                ? 'refunded'
                : providerStatus === 'paid'
                  ? 'paid'
                  : providerStatus === 'void'
                    ? 'void'
                    : 'pending'

        return {
            id,
            issuedAt,
            total: typeof attributes.total === 'number' ? attributes.total : 0,
            currency: typeof attributes.currency === 'string' ? attributes.currency : 'USD',
            status,
            url: isHttps(urls.invoice_url) ? urls.invoice_url : null,
        }
    }

    const variantFor = (planCode: PlanCode, interval: (typeof BILLING_INTERVALS)[number]): number | string => {
        const variant = config.variants[planCode][interval]
        return Number.isInteger(Number(variant)) ? Number(variant) : variant
    }

    const subscriptionPath = (providerSubscriptionId: string): string =>
        `/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}`

    const patchSubscription = async (operation: string, providerSubscriptionId: string, attributes: Json): Promise<void> => {
        await call(operation, subscriptionPath(providerSubscriptionId), {
            method: 'PATCH',
            body: { data: { type: 'subscriptions', id: providerSubscriptionId, attributes } },
        })
    }

    const toSnapshot = (entry: unknown): ProviderSubscriptionSnapshot => {
        const providerSubscriptionId = isObject(entry) ? asId(entry.id) : undefined
        if (!isObject(entry) || !providerSubscriptionId) {
            logger.error('Billing provider returned a subscription with no id', { operation: 'listSubscriptions' })
            throw requestFailed()
        }

        const attributes = isObject(entry.attributes) ? entry.attributes : {}
        const updatedAt = asDate(attributes.updated_at) ?? asDate(attributes.created_at) ?? new Date(0)
        const variantId = asId(attributes.variant_id)
        const endsAt = asDate(attributes.ends_at)
        const renewsAt = asDate(attributes.renews_at)
        const cancelled = attributes.cancelled === true

        return compact({
            providerSubscriptionId,
            providerCustomerId: asId(attributes.customer_id),
            planCode: variantId ? planByVariant.get(variantId) : undefined,
            status: mapStatus(attributes.status, endsAt, updatedAt),
            currentPeriodEnd: cancelled ? (endsAt ?? renewsAt) : renewsAt,
            trialEndsAt: asDate(attributes.trial_ends_at),
            cancelAtPeriodEnd: cancelled,
            updatedAt,
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
                    headers: { Accept: JSON_API, Authorization: `Bearer ${config.apiKey}` },
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
            let pageNumber = 1
            let lastPage = 1

            do {
                const query = new URLSearchParams({
                    'filter[store_id]': config.storeId,
                    'page[number]': String(pageNumber),
                    'page[size]': String(LIST_PAGE_SIZE),
                })
                const body = await call('listSubscriptions', `/v1/subscriptions?${query.toString()}`, { method: 'GET' })

                lastPage = lastPageOf(body)
                if (lastPage > MAX_LIST_PAGES) {
                    logger.error('Billing provider reported an implausible page count', { operation: 'listSubscriptions', lastPage })
                    throw requestFailed()
                }

                if (Array.isArray(body.data)) snapshots.push(...body.data.map(toSnapshot))
                pageNumber += 1
            } while (pageNumber <= lastPage)

            return snapshots
        },

        async listInvoices({ providerSubscriptionId }) {
            const query = new URLSearchParams({
                'filter[store_id]': config.storeId,
                'filter[subscription_id]': providerSubscriptionId,
                'page[size]': String(INVOICE_PAGE_SIZE),
            })
            const body = await call('listInvoices', `/v1/subscription-invoices?${query.toString()}`, { method: 'GET' })

            const entries = Array.isArray(body.data) ? body.data : []
            return entries
                .map(toInvoice)
                .filter((invoice): invoice is ProviderInvoice => invoice !== null)
                .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
        },

        async changePlan({ providerSubscriptionId, planCode, interval }) {
            await patchSubscription('changePlan', providerSubscriptionId, { variant_id: variantFor(planCode, interval) })
        },

        // The provider's cancel call stops all further charges but has no expire-now; `immediate` is honoured to that extent.
        async cancelSubscription({ providerSubscriptionId }) {
            await call('cancelSubscription', subscriptionPath(providerSubscriptionId), { method: 'DELETE' })
        },

        async resumeSubscription({ providerSubscriptionId }) {
            await patchSubscription('resumeSubscription', providerSubscriptionId, { cancelled: false })
        },

        // Ask-only, like the calls above: the resulting invoice status arrives on the refund.issued webhook.
        async refundInvoice({ providerInvoiceId, amountMinor }) {
            await call('refundInvoice', `/v1/subscription-invoices/${encodeURIComponent(providerInvoiceId)}/refund`, {
                method: 'POST',
                body: { data: { type: 'subscription-invoices', id: providerInvoiceId, attributes: { amount: amountMinor } } },
            })
        },

        async createCheckoutSession({ userId, email, planCode, interval, returnUrl }) {
            const body = {
                data: {
                    type: 'checkouts',
                    attributes: {
                        checkout_data: { email, custom: { user_id: userId } },
                        ...(returnUrl ? { product_options: { redirect_url: returnUrl } } : {}),
                    },
                    relationships: {
                        store: { data: { type: 'stores', id: config.storeId } },
                        variant: { data: { type: 'variants', id: config.variants[planCode][interval] } },
                    },
                },
            }

            const url = attributesOf(await call('createCheckoutSession', '/v1/checkouts', { method: 'POST', body })).url
            if (!isHttps(url)) throw requestFailed()
            return { url }
        },

        async getPortalUrl({ providerCustomerId }) {
            const response = await call('getPortalUrl', `/v1/customers/${encodeURIComponent(providerCustomerId)}`, { method: 'GET' })
            const urls = attributesOf(response).urls
            const url = isObject(urls) ? urls.customer_portal : undefined
            if (!isHttps(url)) throw requestFailed()
            return { url }
        },

        verifyWebhook(rawBody, headers) {
            const provided = headers[SIGNATURE_HEADER]
            if (typeof provided !== 'string' || provided === '' || rawBody.length === 0) return false

            const expected = crypto.createHmac('sha256', config.webhookSecret).update(rawBody).digest('hex')
            const a = Buffer.from(provided)
            const b = Buffer.from(expected)
            return a.length === b.length && crypto.timingSafeEqual(a, b)
        },

        parseEvent(rawBody): NormalizedBillingEvent {
            let root: unknown
            try {
                root = JSON.parse(rawBody.toString('utf8'))
            } catch {
                throw payloadInvalid()
            }
            if (!isObject(root) || !isObject(root.meta) || !isObject(root.data) || !isObject(root.data.attributes)) {
                throw payloadInvalid()
            }
            const eventName = root.meta.event_name
            if (typeof eventName !== 'string' || eventName === '') throw payloadInvalid()

            const attributes = root.data.attributes
            const mappedType = EVENT_TYPES[eventName]
            const providerEventId = `mor_${crypto.createHash('sha256').update(rawBody).digest('hex')}`

            const stamp = attributes.updated_at ?? attributes.created_at
            const occurredAt = asDate(stamp)
            if (!occurredAt && mappedType) throw payloadInvalid()

            const isSubscriptionResource = eventName.startsWith('subscription_') && !eventName.startsWith('subscription_payment_')
            const providerCustomerId = asId(attributes.customer_id)
            const providerSubscriptionId = isSubscriptionResource ? asId(root.data.id) : asId(attributes.subscription_id)
            const variantId = asId(attributes.variant_id)
            const endsAt = asDate(attributes.ends_at)
            const renewsAt = asDate(attributes.renews_at)
            const trialEndsAt = asDate(attributes.trial_ends_at)

            const payload = compact({
                providerEventName: eventName,
                providerCustomerId,
                providerSubscriptionId,
                providerStatus: typeof attributes.status === 'string' ? attributes.status : undefined,
                variantId,
                cancelled: typeof attributes.cancelled === 'boolean' ? attributes.cancelled : undefined,
                renewsAt: renewsAt?.toISOString(),
                endsAt: endsAt?.toISOString(),
                trialEndsAt: trialEndsAt?.toISOString(),
                billingReason: typeof attributes.billing_reason === 'string' ? attributes.billing_reason : undefined,
                total: typeof attributes.total === 'number' ? attributes.total : undefined,
                currency: typeof attributes.currency === 'string' ? attributes.currency : undefined,
                refunded: typeof attributes.refunded === 'boolean' ? attributes.refunded : undefined,
            })

            if (!mappedType) {
                return { providerEventId, type: eventName, occurredAt: occurredAt ?? new Date(), payload }
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
                const customData = root.meta.custom_data
                const userId = isObject(customData) && typeof customData.user_id === 'string' ? customData.user_id : undefined
                const cancelled = attributes.cancelled === true

                event.userId = userId
                event.planCode = variantId ? planByVariant.get(variantId) : undefined
                event.interval = variantId ? (intervalByVariant.get(variantId) ?? null) : undefined
                event.status =
                    eventName === 'subscription_expired'
                        ? 'cancelled'
                        : mapStatus(attributes.status, endsAt, occurredAt as Date)
                event.cancelAtPeriodEnd = cancelled
                event.currentPeriodEnd = cancelled ? (endsAt ?? renewsAt) : renewsAt
                event.trialEndsAt = trialEndsAt
            }

            return event
        },
    }
}
