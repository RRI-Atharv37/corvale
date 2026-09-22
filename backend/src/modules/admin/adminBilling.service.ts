import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    differingFields,
    getBillingProvider,
    recomputeUsageCounters,
    recomputeWorkspaceSeats,
    revokeSyncDevice,
    replayBillingEvent as replayLedgerEvent,
    type ProviderSubscriptionSnapshot,
} from '@modules/billing'

import { recordAudit, validateReason } from './adminAudit.service'
import { applyProviderFields, findDeviceByRef, findOwnedWorkspaces, findSubscriptionByUserId, type SubscriptionRow } from './adminData.service'
import type { AdminPrincipal, AdminRequestContext } from './adminTypes'

/**
 * M7.5 - provider actions: refund, cancel, resync, recompute usage, device revoke, and the event-replay
 * stretch. Refund/cancel/resync ask the provider or apply its truth; none of them invents state Corvale
 * doesn't already have from a webhook or a live provider read (D9: refund has no automatic entitlement
 * effect - the resolver is untouched by anything here).
 */

const OBJECT_ID = /^[0-9a-f]{24}$/i
const DEVICE_REF = /^[0-9a-f]{8}$/i

const requireUserId = (value: unknown): string => {
    if (typeof value !== 'string' || !OBJECT_ID.test(value)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)
    return value
}

const requireSubscription = async (userId: string): Promise<SubscriptionRow> => {
    const subscription = await findSubscriptionByUserId(userId)
    if (!subscription) throw new CustomError(ERROR_MESSAGES.ADMIN.SUBSCRIBER_NOT_FOUND, 404)
    return subscription
}

const requireLinkedSubscription = async (userId: string): Promise<SubscriptionRow & { providerSubscriptionId: string }> => {
    const subscription = await requireSubscription(userId)
    if (!subscription.providerSubscriptionId) throw new CustomError(ERROR_MESSAGES.ADMIN.NOT_PROVIDER_LINKED, 400)
    return subscription as SubscriptionRow & { providerSubscriptionId: string }
}

const auditBase = (actor: AdminPrincipal, ctx: AdminRequestContext, userId: string, subscription: SubscriptionRow, now: Date) => ({
    adminId: actor.id,
    adminRole: actor.role,
    subjectUserId: userId,
    subjectSubscriptionId: subscription._id,
    ip: ctx.ip,
    requestId: ctx.requestId,
    at: now,
})

// -------- invoices (for the refund picker) --------

export const listSubscriberInvoices = async (userIdParam: unknown) => {
    const userId = requireUserId(userIdParam)
    const subscription = await requireLinkedSubscription(userId)
    return { invoices: await getBillingProvider().listInvoices({ providerSubscriptionId: subscription.providerSubscriptionId }) }
}

// -------- refund --------

interface RefundInput {
    providerInvoiceId?: unknown
    confirmAmountMinor?: unknown
    reason?: unknown
}

/** 202 "requested": the resulting invoice status arrives on the `refund.issued` webhook (D9, record-only). */
export const refundInvoice = async (
    actor: AdminPrincipal,
    userIdParam: unknown,
    input: RefundInput,
    ctx: AdminRequestContext,
    now: Date = new Date()
) => {
    const userId = requireUserId(userIdParam)
    if (typeof input.providerInvoiceId !== 'string' || input.providerInvoiceId === '') throw new CustomError(ERROR_MESSAGES.ADMIN.INVOICE_NOT_FOUND, 400)
    if (typeof input.confirmAmountMinor !== 'number' || !Number.isInteger(input.confirmAmountMinor) || input.confirmAmountMinor <= 0) {
        throw new CustomError(ERROR_MESSAGES.ADMIN.REFUND_AMOUNT_MISMATCH, 400)
    }
    const reason = validateReason(input.reason)
    const subscription = await requireLinkedSubscription(userId)

    const invoices = await getBillingProvider().listInvoices({ providerSubscriptionId: subscription.providerSubscriptionId })
    const invoice = invoices.find((row) => row.id === input.providerInvoiceId)
    if (!invoice) throw new CustomError(ERROR_MESSAGES.ADMIN.INVOICE_NOT_FOUND, 404)
    if (invoice.status !== 'paid') throw new CustomError(ERROR_MESSAGES.ADMIN.INVOICE_NOT_REFUNDABLE, 400)
    if (invoice.total !== input.confirmAmountMinor) throw new CustomError(ERROR_MESSAGES.ADMIN.REFUND_AMOUNT_MISMATCH, 400)

    await getBillingProvider().refundInvoice({ providerInvoiceId: invoice.id, amountMinor: invoice.total })

    await recordAudit({
        ...auditBase(actor, ctx, userId, subscription, now),
        action: 'billing.refund',
        amountMinor: invoice.total,
        currency: invoice.currency,
        reason,
    })

    return { requested: true }
}

// -------- cancel --------

/**
 * At period end, or now. The real MoR adapter's cancel call has no expire-now (`morProvider.ts`); `immediate`
 * is honoured only as far as the provider allows, same caveat as the erasure-time cancel (M7.0). Verify at M0.
 */
const cancel = async (
    actor: AdminPrincipal,
    userIdParam: unknown,
    input: { reason?: unknown },
    ctx: AdminRequestContext,
    now: Date,
    immediate: boolean
) => {
    const userId = requireUserId(userIdParam)
    const reason = validateReason(input.reason)
    const subscription = await requireLinkedSubscription(userId)

    await getBillingProvider().cancelSubscription({ providerSubscriptionId: subscription.providerSubscriptionId, immediate })

    await recordAudit({
        ...auditBase(actor, ctx, userId, subscription, now),
        action: immediate ? 'billing.cancel_now' : 'billing.cancel_at_period_end',
        reason,
    })

    return { requested: true }
}

export const cancelAtPeriodEnd = (actor: AdminPrincipal, userIdParam: unknown, input: { reason?: unknown }, ctx: AdminRequestContext, now: Date = new Date()) =>
    cancel(actor, userIdParam, input, ctx, now, false)

export const cancelNow = (actor: AdminPrincipal, userIdParam: unknown, input: { reason?: unknown }, ctx: AdminRequestContext, now: Date = new Date()) =>
    cancel(actor, userIdParam, input, ctx, now, true)

// -------- resync --------

type SnapshotRecord = Record<string, unknown>

const remoteSnapshotFor = async (subscription: SubscriptionRow & { providerSubscriptionId: string }): Promise<ProviderSubscriptionSnapshot> => {
    const snapshot = await getBillingProvider().getSubscriptionSnapshot({ providerSubscriptionId: subscription.providerSubscriptionId })
    if (!snapshot) throw new CustomError(ERROR_MESSAGES.ADMIN.SNAPSHOT_UNAVAILABLE, 404)
    return snapshot
}

/** Field name, this row's value, the provider's value - the diff-first view the plan calls for, built on the same comparison reconciliation uses. */
const buildDiff = (subscription: SubscriptionRow, remote: ProviderSubscriptionSnapshot) =>
    differingFields(subscription, remote).map((field) => ({
        field,
        local: (subscription as unknown as SnapshotRecord)[field] ?? null,
        remote: (remote as unknown as SnapshotRecord)[field] ?? null,
    }))

export const previewResync = async (userIdParam: unknown) => {
    const userId = requireUserId(userIdParam)
    const subscription = await requireLinkedSubscription(userId)
    const remote = await remoteSnapshotFor(subscription)

    return { differences: buildDiff(subscription, remote) }
}

export const applyResync = async (
    actor: AdminPrincipal,
    userIdParam: unknown,
    input: { reason?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
) => {
    const userId = requireUserId(userIdParam)
    const reason = validateReason(input.reason)
    const subscription = await requireLinkedSubscription(userId)
    const remote = await remoteSnapshotFor(subscription)
    const differences = buildDiff(subscription, remote)
    if (differences.length === 0) throw new CustomError(ERROR_MESSAGES.ADMIN.NO_DIFFERENCE, 400)

    const patch: SnapshotRecord = {}
    for (const diff of differences) patch[diff.field] = (remote as unknown as SnapshotRecord)[diff.field]

    const previous = await applyProviderFields(userId, patch)
    if (!previous) throw new CustomError(ERROR_MESSAGES.ADMIN.SUBSCRIBER_NOT_FOUND, 404)

    const before: SnapshotRecord = {}
    const after: SnapshotRecord = {}
    for (const diff of differences) {
        before[diff.field] = (previous as unknown as SnapshotRecord)[diff.field] ?? null
        after[diff.field] = patch[diff.field] ?? null
    }

    await recordAudit({ ...auditBase(actor, ctx, userId, subscription, now), action: 'billing.resync', before, after, reason })

    return { fields: differences.map((diff) => diff.field) }
}

// -------- recompute usage --------

export const recomputeUsage = async (
    actor: AdminPrincipal,
    userIdParam: unknown,
    input: { reason?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
) => {
    const userId = requireUserId(userIdParam)
    const reason = validateReason(input.reason)
    const subscription = await requireSubscription(userId)

    await recomputeUsageCounters(userId)
    const workspaces = await findOwnedWorkspaces(userId)
    for (const workspace of workspaces) await recomputeWorkspaceSeats(workspace._id.toString())

    await recordAudit({ ...auditBase(actor, ctx, userId, subscription, now), action: 'billing.usage_recomputed', reason })

    return { recomputed: true, workspacesRecomputed: workspaces.length }
}

// -------- device revoke --------

export const revokeDevice = async (
    actor: AdminPrincipal,
    userIdParam: unknown,
    deviceRefParam: unknown,
    input: { reason?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
) => {
    const userId = requireUserId(userIdParam)
    if (typeof deviceRefParam !== 'string' || !DEVICE_REF.test(deviceRefParam)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)
    const reason = validateReason(input.reason)
    const subscription = await requireSubscription(userId)

    const match = await findDeviceByRef(userId, deviceRefParam)
    if (match === null) throw new CustomError(ERROR_MESSAGES.SYNC.DEVICE_NOT_FOUND, 404)
    if (match === 'ambiguous') throw new CustomError(ERROR_MESSAGES.ADMIN.DEVICE_REF_AMBIGUOUS, 409)

    await revokeSyncDevice(userId, match.deviceId)

    await recordAudit({ ...auditBase(actor, ctx, userId, subscription, now), action: 'device.revoked', reason })

    return { revoked: true }
}

// -------- event replay (stretch) --------

/**
 * Re-runs one ledgered event that never applied. Not scoped to a subscriber - the ledger row may predate
 * any local link - so the audit row carries no subject. Cannot relink an unlinked `subscription.created`
 * (its `userId` is deliberately never persisted to the ledger, D-privacy); every other event type acts on
 * an already-linked row via `providerSubscriptionId`, which the ledger does carry.
 */
export const replayEvent = async (actor: AdminPrincipal, eventIdParam: unknown, input: { reason?: unknown }, ctx: AdminRequestContext, now: Date = new Date()) => {
    if (typeof eventIdParam !== 'string' || !OBJECT_ID.test(eventIdParam)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)
    const reason = validateReason(input.reason)

    const outcome = await replayLedgerEvent(eventIdParam)
    if (!outcome) throw new CustomError(ERROR_MESSAGES.ADMIN.EVENT_NOT_REPLAYABLE, 404)

    await recordAudit({
        adminId: actor.id,
        adminRole: actor.role,
        ip: ctx.ip,
        requestId: ctx.requestId,
        at: now,
        action: 'billing_event.replayed',
        reason,
    })

    return outcome
}
