import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'

import {
    maskEmail,
    maskProviderId,
    toBillingEventView,
    toDeviceView,
    toSubscriberDetailAccount,
    toSubscriberDetailLegal,
    toSubscriberDetailSubscription,
    toSubscriberListItem,
    toWorkspaceView,
} from '../adminViews'

/**
 * M7.2 - allowlist serializers. Each spec pins the EXACT key set, so a field added to a model tomorrow
 * cannot reach an operator's screen by accident: someone has to change these lists on purpose.
 */

const keys = (value: object): string[] => Object.keys(value).sort()
const oid = (): Types.ObjectId => new Types.ObjectId()

describe('masking', () => {
    it('keeps the first character and the domain of an email', () => {
        expect(maskEmail('jane.doe@example.com')).toBe('j***@example.com')
        expect(maskEmail('a@b.co')).toBe('a***@b.co')
    })

    it('masks anything that is not an email completely', () => {
        expect(maskEmail('')).toBe('***')
        expect(maskEmail('not-an-email')).toBe('***')
    })

    it('keeps only the last six characters of a provider id', () => {
        expect(maskProviderId('sub_1234567890')).toBe('…567890')
        expect(maskProviderId('abc')).toBe('…abc')
        expect(maskProviderId(null)).toBeNull()
        expect(maskProviderId(undefined)).toBeNull()
    })
})

const subscriptionDoc = () => ({
    _id: oid(),
    userId: oid(),
    planCode: 'pro' as const,
    status: 'past_due' as const,
    trialEndsAt: null,
    currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
    cancelAtPeriodEnd: false,
    pastDueSince: new Date('2026-09-15T00:00:00.000Z'),
    dunningStage: 'payment_failed' as const,
    lapsedAt: null,
    retentionStage: null,
    retentionStageAt: null,
    grandfatherKind: null,
    adminGrant: null,
    retentionHoldUntil: null,
    providerCustomerId: 'cus_123456789',
    providerSubscriptionId: 'sub_987654321',
    lastEventAt: new Date('2026-09-15T01:00:00.000Z'),
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-15T01:00:00.000Z'),
    // things that must never leak even if a document carries them
    password: 'hash',
    tokenVersion: 3,
    internalNote: 'x',
})

describe('toSubscriberListItem', () => {
    const item = toSubscriberListItem({
        userId: oid().toString(),
        email: 'jane.doe@example.com',
        subscription: subscriptionDoc() as never,
        resolvedStatus: 'past_due',
        canWrite: true,
        now: new Date('2026-09-21T00:00:00.000Z'),
    })

    it('exposes exactly the list fields', () => {
        expect(keys(item)).toEqual(
            [
                'canWrite',
                'cancelAtPeriodEnd',
                'currentPeriodEnd',
                'dunningStage',
                'email',
                'grandfatherKind',
                'hasAdminGrant',
                'lastEventAt',
                'onRetentionHold',
                'pastDueSince',
                'planCode',
                'providerLinked',
                'providerSubscriptionId',
                'resolvedStatus',
                'retentionStage',
                'status',
                'trialEndsAt',
                'userId',
            ].sort()
        )
    })

    it('masks the email and the provider id, and never carries the customer id', () => {
        expect(item.email).toBe('j***@example.com')
        expect(item.providerSubscriptionId).toBe('…654321')
        expect(item.providerLinked).toBe(true)
        expect(JSON.stringify(item)).not.toContain('cus_123456789')
        expect(JSON.stringify(item)).not.toContain('sub_987654321')
        expect(JSON.stringify(item)).not.toContain('jane.doe')
    })

    it('handles a user with no subscription row', () => {
        const none = toSubscriberListItem({ userId: oid().toString(), email: 'x@y.co', subscription: null, resolvedStatus: 'none', canWrite: false, now: new Date() })

        expect(none.planCode).toBeNull()
        expect(none.status).toBeNull()
        expect(none.providerLinked).toBe(false)
        expect(none.hasAdminGrant).toBe(false)
    })
})

describe('detail sections', () => {
    it('account: id, full email, creation date, verification', () => {
        const view = toSubscriberDetailAccount({
            _id: oid(),
            email: 'jane.doe@example.com',
            createdAt: new Date(),
            isEmailVerified: true,
            password: 'hash',
            tokenVersion: 2,
            fullName: 'Jane Doe',
            timezone: 'UTC',
            preferredCurrency: 'USD',
        } as never)

        expect(keys(view)).toEqual(['createdAt', 'email', 'isEmailVerified', 'userId'])
        expect(view.email).toBe('jane.doe@example.com')
    })

    it('legal: the terms evidence only, or nulls when absent', () => {
        const view = toSubscriberDetailLegal({ termsVersion: '2026-09', privacyVersion: '2026-09', acceptedAt: new Date(), ageAttested: true, extra: 1 } as never)

        expect(keys(view)).toEqual(['acceptedAt', 'ageAttested', 'privacyVersion', 'termsVersion'])
        expect(toSubscriberDetailLegal(undefined)).toEqual({ termsVersion: null, privacyVersion: null, acceptedAt: null, ageAttested: null })
    })

    it('subscription: every billing field including the provider ids, and nothing else', () => {
        const view = toSubscriberDetailSubscription(subscriptionDoc() as never)

        expect(keys(view)).toEqual(
            [
                'adminGrant',
                'cancelAtPeriodEnd',
                'createdAt',
                'currentPeriodEnd',
                'dunningStage',
                'grandfatherKind',
                'id',
                'lapsedAt',
                'lastEventAt',
                'pastDueSince',
                'planCode',
                'providerCustomerId',
                'providerSubscriptionId',
                'retentionHoldUntil',
                'retentionStage',
                'retentionStageAt',
                'status',
                'trialEndsAt',
                'updatedAt',
            ].sort()
        )
        expect(view.providerCustomerId).toBe('cus_123456789')
        expect(JSON.stringify(view)).not.toContain('tokenVersion')
        expect(JSON.stringify(view)).not.toContain('internalNote')
    })

    it('subscription: a grant is shown without its free-text reason', () => {
        const view = toSubscriberDetailSubscription({
            ...subscriptionDoc(),
            adminGrant: { kind: 'comp', planCode: 'pro', until: new Date('2026-12-01T00:00:00.000Z'), reason: 'jane asked', grantedBy: oid(), grantedAt: new Date() },
        } as never)

        expect(keys(view.adminGrant as object)).toEqual(['grantedAt', 'grantedBy', 'kind', 'limits', 'planCode', 'until'])
        expect(JSON.stringify(view.adminGrant)).not.toContain('jane asked')
    })
})

describe('toDeviceView', () => {
    it('shows a truncated id and the kind, never the user-chosen name', () => {
        const view = toDeviceView({ deviceId: 'abcdef0123456789abcdef0123456789', kind: 'desktop', name: "Jane's private laptop", firstSeenAt: new Date(), lastSeenAt: new Date() } as never, true)

        expect(keys(view)).toEqual(['canPush', 'deviceRef', 'firstSeenAt', 'kind', 'lastSeenAt'])
        expect(view.deviceRef).toBe('abcdef01')
        expect(JSON.stringify(view)).not.toContain('private laptop')
    })

    it('reports an unidentified device kind as null', () => {
        expect(toDeviceView({ deviceId: '_legacy', firstSeenAt: new Date(), lastSeenAt: new Date() } as never, false).kind).toBeNull()
    })
})

describe('toWorkspaceView', () => {
    it('shows the id and the seat count, never the name or the members', () => {
        const view = toWorkspaceView({ _id: oid(), name: 'Family budget', members: [{ userId: oid() }, { userId: oid() }] } as never)

        expect(keys(view)).toEqual(['id', 'seatCount'])
        expect(view.seatCount).toBe(2)
    })
})

describe('toBillingEventView', () => {
    const event = {
        _id: oid(),
        providerEventId: 'evt_secret_1',
        type: 'payment.succeeded',
        occurredAt: new Date('2026-09-10T00:00:00.000Z'),
        processedAt: new Date('2026-09-10T00:00:01.000Z'),
        error: null,
        redactedAt: null,
        payload: {
            providerCustomerId: 'cus_123456789',
            providerSubscriptionId: 'sub_987654321',
            planCode: 'pro',
            status: 'active',
            total: 900,
            currency: 'USD',
            billingReason: 'renewal',
            variantId: 'v1',
            userEmail: 'leak@example.com',
            customerName: 'Jane',
        },
    }

    it('exposes the event and an allowlisted payload', () => {
        const view = toBillingEventView(event as never)

        expect(keys(view)).toEqual(['error', 'id', 'occurredAt', 'payload', 'processedAt', 'redacted', 'type'])
        expect(view.payload).toEqual({ planCode: 'pro', status: 'active', total: 900, currency: 'USD', billingReason: 'renewal' })
    })

    it('never shows the provider event id, provider ids, or anything that looks like an email or a name', () => {
        const raw = JSON.stringify(toBillingEventView(event as never))

        for (const banned of ['evt_secret_1', 'cus_123456789', 'sub_987654321', 'leak@example.com', 'Jane', 'variantId']) {
            expect(raw).not.toContain(banned)
        }
    })

    it('marks a redacted row and truncates a long error', () => {
        const view = toBillingEventView({ ...event, redactedAt: new Date(), error: 'x'.repeat(900) } as never)

        expect(view.redacted).toBe(true)
        expect(view.error?.length).toBeLessThanOrEqual(300)
    })
})
