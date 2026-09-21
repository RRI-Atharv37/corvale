import { PLAN_CODES, type PlanCode } from '@core/billing/constants'
import { TRIAL_LENGTH_DAYS } from '@core/billing/entitlements'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { User } from '@modules/users'

import { getUserEntitlements, isBillingEnabled } from './entitlement.service'
import { DEFAULT_PLAN_CATALOGUE, type PlanCatalogueEntry } from './planCatalogue'
import Plan from './plan.model'
import { BILLING_INTERVALS, type BillingInterval, type ProviderInvoice } from './providers/billingProvider'
import { getBillingProvider } from './providers/providerRegistry'
import { getRetentionDays, isRetentionEnabled } from './retention.service'
import Subscription, { type ISubscription } from './subscription.model'
import { listSyncDevices, parseDeviceId } from './syncDevice.service'

export interface PublicPlan {
    code: PlanCode
    name: string
    prices: PlanCatalogueEntry['prices']
    features: PlanCatalogueEntry['features']
    limits: PlanCatalogueEntry['limits']
}

export interface PublicPlans {
    billingEnabled: boolean
    trialDays: number
    plans: PublicPlan[]
}

export interface BillingOverview {
    billingEnabled: boolean
    hasBillingCustomer: boolean
    hasLiveSubscription: boolean
    /** Null unless the server is really enforcing a retention window - the UI never states one it does not run. */
    retentionDays: number | null
}

export interface PlanSelection {
    planCode: PlanCode
    interval: BillingInterval
}

const LIVE_STATUSES: ReadonlyArray<ISubscription['status']> = ['active', 'trialing', 'past_due']

export const assertBillingEnabled = (): void => {
    if (!isBillingEnabled()) throw new CustomError(ERROR_MESSAGES.BILLING.NOT_ENABLED, 404)
}

/** Body values arrive from the network; anything that is not exactly a known plan and interval is a 400. */
export const parsePlanSelection = (body: unknown): PlanSelection => {
    const { planCode, interval } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

    const validPlan = typeof planCode === 'string' && (PLAN_CODES as readonly string[]).includes(planCode)
    const validInterval = typeof interval === 'string' && (BILLING_INTERVALS as readonly string[]).includes(interval)
    if (!validPlan || !validInterval) throw new CustomError(ERROR_MESSAGES.BILLING.INVALID_PLAN, 400)

    return { planCode: planCode as PlanCode, interval: interval as BillingInterval }
}

export const getPublicPlans = async (): Promise<PublicPlans> => {
    if (!isBillingEnabled()) return { billingEnabled: false, trialDays: TRIAL_LENGTH_DAYS, plans: [] }

    const rows = await Plan.find({}).lean()
    const plans = DEFAULT_PLAN_CATALOGUE.map((entry): PublicPlan => {
        const row = rows.find((candidate) => candidate.code === entry.code)
        return {
            code: entry.code,
            name: row?.name ?? entry.name,
            prices: {
                monthly: row?.prices?.monthly ?? entry.prices.monthly,
                annual: row?.prices?.annual ?? entry.prices.annual,
            },
            features: {
                workspaces: row?.features?.workspaces ?? entry.features.workspaces,
                prioritySupport: row?.features?.prioritySupport ?? entry.features.prioritySupport,
                bankSync: row?.features?.bankSync ?? entry.features.bankSync,
            },
            limits: {
                receiptStorageBytes: row ? (row.limits?.receiptStorageBytes ?? null) : entry.limits.receiptStorageBytes,
                syncDevices: row ? (row.limits?.syncDevices ?? null) : entry.limits.syncDevices,
                workspaceMembers: row ? (row.limits?.workspaceMembers ?? null) : entry.limits.workspaceMembers,
            },
        }
    })

    return { billingEnabled: true, trialDays: TRIAL_LENGTH_DAYS, plans }
}

/**
 * "Live" means the provider is still billing it and the account can still write: an ended
 * subscription keeps its provider link but cannot be changed, only replaced by a new checkout.
 */
const loadLiveSubscription = async (userId: string): Promise<ISubscription | null> => {
    const subscription = await Subscription.findOne({ userId })
    if (!subscription?.providerSubscriptionId || !LIVE_STATUSES.includes(subscription.status)) return null

    return (await getUserEntitlements(userId)).canWrite ? subscription : null
}

const requireLiveSubscription = async (userId: string): Promise<ISubscription & { providerSubscriptionId: string }> => {
    const subscription = await loadLiveSubscription(userId)
    if (!subscription?.providerSubscriptionId) {
        throw new CustomError(ERROR_MESSAGES.BILLING.NO_ACTIVE_SUBSCRIPTION, 409)
    }
    return subscription as ISubscription & { providerSubscriptionId: string }
}

export const getBillingOverview = async (userId: string): Promise<BillingOverview> => {
    if (!isBillingEnabled()) {
        return { billingEnabled: false, hasBillingCustomer: false, hasLiveSubscription: false, retentionDays: null }
    }

    const subscription = await Subscription.findOne({ userId }).lean()
    return {
        billingEnabled: true,
        hasBillingCustomer: !!subscription?.providerCustomerId,
        hasLiveSubscription: (await loadLiveSubscription(userId)) !== null,
        retentionDays: isRetentionEnabled() ? getRetentionDays() : null,
    }
}

export const startCheckout = async (userId: string, selection: PlanSelection): Promise<{ url: string }> => {
    assertBillingEnabled()

    if (await loadLiveSubscription(userId)) throw new CustomError(ERROR_MESSAGES.BILLING.ALREADY_SUBSCRIBED, 409)

    const user = await User.findById(userId).select('email').lean()
    if (!user) throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)

    return getBillingProvider().createCheckoutSession({ userId, email: user.email, ...selection })
}

export const openPortal = async (userId: string): Promise<{ url: string }> => {
    assertBillingEnabled()

    const subscription = await Subscription.findOne({ userId }).lean()
    if (!subscription?.providerCustomerId) throw new CustomError(ERROR_MESSAGES.BILLING.NO_BILLING_CUSTOMER, 404)

    return getBillingProvider().getPortalUrl({ providerCustomerId: subscription.providerCustomerId })
}

/** Only asks the provider; the new plan takes effect in Corvale when its webhook arrives. */
export const requestPlanChange = async (userId: string, selection: PlanSelection): Promise<void> => {
    assertBillingEnabled()

    const { providerSubscriptionId } = await requireLiveSubscription(userId)
    await getBillingProvider().changePlan({ providerSubscriptionId, ...selection })
}

export const requestCancellation = async (userId: string): Promise<void> => {
    assertBillingEnabled()

    const subscription = await requireLiveSubscription(userId)
    if (subscription.cancelAtPeriodEnd) throw new CustomError(ERROR_MESSAGES.BILLING.ALREADY_CANCELLING, 409)

    await getBillingProvider().cancelSubscription({ providerSubscriptionId: subscription.providerSubscriptionId })
}

export const requestResume = async (userId: string): Promise<void> => {
    assertBillingEnabled()

    const subscription = await requireLiveSubscription(userId)
    if (!subscription.cancelAtPeriodEnd) throw new CustomError(ERROR_MESSAGES.BILLING.NOT_CANCELLING, 409)

    await getBillingProvider().resumeSubscription({ providerSubscriptionId: subscription.providerSubscriptionId })
}

/** Available in every state: a lapsed user must still be able to fetch their receipts. */
export const listInvoices = async (userId: string): Promise<ProviderInvoice[]> => {
    assertBillingEnabled()

    const subscription = await Subscription.findOne({ userId }).lean()
    if (!subscription?.providerSubscriptionId) return []

    return getBillingProvider().listInvoices({ providerSubscriptionId: subscription.providerSubscriptionId })
}

export const getSyncDevices = async (userId: string, rawCurrentDeviceId: unknown) => {
    const currentDeviceId = parseDeviceId(rawCurrentDeviceId)
    const { limits } = await getUserEntitlements(userId)
    return listSyncDevices(userId, currentDeviceId, limits.syncDevices)
}
