import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import app from '@http/app'
import { setMailTransport, type MailMessage } from '@infra/mail/mailService'
import { User } from '@modules/users'
import {
    Subscription,
    expireLapsedTrials,
    getUserEntitlements,
    runRetentionSweep,
    sendDunningEmails,
} from '@modules/billing'
import { registerUser, type RegisteredUser } from '@tests/helpers'
import { DAY_MS, disableBilling, enableBilling, seedTestPlans, setSubscription } from '@tests/billingHelpers'

/**
 * M7.3 - the sweeps honour staff grants: a comped, lapsed customer is not dunned or warned or erased, a held
 * account is not erased, and when a hold or comp ends the retention window restarts so the person gets a full
 * notice cycle instead of a same-day final warning. The highest-risk seam in M7: it decides an erasure.
 */

const NOW = new Date('2027-01-01T12:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)
const daysAfter = (days: number) => new Date(NOW.getTime() + days * DAY_MS)

const compUntil = (until: Date) => ({ kind: 'comp', planCode: 'pro', until, grantedBy: '000000000000000000000001', grantedAt: daysAgo(1) })

let user: RegisteredUser
let sent: MailMessage[]

const stored = () => Subscription.findOne({ userId: user.userId }).lean()
const userExists = async () => (await User.findById(user.userId)) !== null

beforeEach(async () => {
    process.env.SMTP_HOST = 'smtp.test.local'
    process.env.BILLING_RETENTION_ENABLED = 'true'
    sent = []
    setMailTransport({
        sendMail: vi.fn(async (message: MailMessage) => {
            sent.push(message)
            return { messageId: `m-${sent.length}` }
        }),
    })

    enableBilling()
    await seedTestPlans()
    user = await registerUser(app)
    await Subscription.deleteMany({})
    sent = []
})

afterEach(() => {
    disableBilling()
    delete process.env.SMTP_HOST
    delete process.env.BILLING_RETENTION_ENABLED
    setMailTransport(null)
})

const lapse = (days: number, extra: Record<string, unknown> = {}) =>
    setSubscription(user.userId, { status: 'cancelled', currentPeriodEnd: daysAgo(days), lapsedAt: daysAgo(days), ...extra })

const setOverlay = (fields: Record<string, unknown>) => Subscription.updateOne({ userId: user.userId }, { $set: fields })

describe('dunning', () => {
    const pastDue = () => setSubscription(user.userId, { status: 'past_due', pastDueSince: daysAgo(1), currentPeriodEnd: null })

    it('emails a past-due customer as before', async () => {
        await pastDue()

        const result = await sendDunningEmails(NOW)

        expect(result.sent).toBe(1)
        expect((await stored())?.dunningStage).toBe('payment_failed')
    })

    it('does not chase a customer who has an active comp', async () => {
        await pastDue()
        await setOverlay({ adminGrant: compUntil(daysAfter(10)) })

        const result = await sendDunningEmails(NOW)

        expect(result.sent).toBe(0)
        expect(sent).toHaveLength(0)
        expect((await stored())?.dunningStage ?? null).toBeNull()
    })

    it('resumes once the comp has ended', async () => {
        await pastDue()
        await setOverlay({ adminGrant: compUntil(daysAgo(1)) })

        expect((await sendDunningEmails(NOW)).sent).toBe(1)
    })

    it('a plan override does not stop dunning: the customer still owes a payment', async () => {
        await pastDue()
        await setOverlay({ adminGrant: { kind: 'plan_override', planCode: 'pro', until: daysAfter(10), grantedBy: '000000000000000000000001', grantedAt: daysAgo(1) } })

        expect((await sendDunningEmails(NOW)).sent).toBe(1)
    })
})

describe('trial expiry stays honest', () => {
    it('still marks a lapsed trial as expired, while the comp keeps the customer writable', async () => {
        await setSubscription(user.userId, { status: 'trialing', trialEndsAt: daysAgo(2), currentPeriodEnd: null, providerCustomerId: null, providerSubscriptionId: null })
        await setOverlay({ adminGrant: compUntil(daysAfter(10)) })

        await expireLapsedTrials(NOW)

        expect((await stored())?.status).toBe('trial_expired')
        expect((await getUserEntitlements(user.userId, NOW)).canWrite).toBe(true)
        expect((await getUserEntitlements(user.userId, daysAfter(11))).canWrite).toBe(false)
    })
})

describe('retention - notices', () => {
    it('sends the first notice to a lapsed customer as before', async () => {
        await lapse(1)

        const result = await runRetentionSweep(NOW)

        expect(result.notified).toBe(1)
        expect((await stored())?.retentionStage).toBe('notice')
    })

    it('sends nothing to a lapsed customer with an active comp, and keeps their state untouched', async () => {
        await lapse(1)
        await setOverlay({ adminGrant: compUntil(daysAfter(10)) })

        const result = await runRetentionSweep(NOW)

        expect(result.notified).toBe(0)
        expect(sent).toHaveLength(0)
        expect((await stored())?.retentionStage ?? null).toBeNull()
    })

    it('sends nothing while an erasure hold is running', async () => {
        await lapse(1)
        await setOverlay({ retentionHoldUntil: daysAfter(10) })

        expect((await runRetentionSweep(NOW)).notified).toBe(0)
        expect(sent).toHaveLength(0)
    })
})

describe('retention - erasure', () => {
    const readyToErase = () => lapse(181, { retentionStage: 'final_warning', retentionStageAt: daysAgo(8) })

    it('erases a due account as before', async () => {
        await readyToErase()

        const result = await runRetentionSweep(NOW)

        expect(result.deleted).toBe(1)
        expect(await userExists()).toBe(false)
    })

    it('never erases an account with an active comp', async () => {
        await readyToErase()
        await setOverlay({ adminGrant: compUntil(daysAfter(10)) })

        const result = await runRetentionSweep(NOW)

        expect(result.deleted).toBe(0)
        expect(await userExists()).toBe(true)
    })

    it('never erases an account under an erasure hold', async () => {
        await readyToErase()
        await setOverlay({ retentionHoldUntil: daysAfter(10) })

        const result = await runRetentionSweep(NOW)

        expect(result.deleted).toBe(0)
        expect(await userExists()).toBe(true)
        expect((await stored())?.retentionStage).toBe('final_warning')
    })

    it('erases again only after the hold has ended AND a full notice cycle has run', async () => {
        await readyToErase()
        await setOverlay({ retentionHoldUntil: daysAgo(1) })

        const first = await runRetentionSweep(NOW)

        expect(first.deleted).toBe(0)
        expect(await userExists()).toBe(true)
        const restarted = await stored()
        expect(restarted?.lapsedAt?.getTime()).toBe(daysAgo(1).getTime())
        expect(restarted?.retentionStage).toBe('notice')
        expect(first.notified).toBe(1)

        const later = await runRetentionSweep(daysAfter(300))
        expect(later.deleted).toBe(0)
        expect((await stored())?.retentionStage).toBe('final_warning')
    })

    it('restarts the clock when a comp ends too', async () => {
        await readyToErase()
        await setOverlay({ adminGrant: compUntil(daysAgo(2)) })

        const result = await runRetentionSweep(NOW)

        expect(result.deleted).toBe(0)
        expect((await stored())?.lapsedAt?.getTime()).toBe(daysAgo(2).getTime())
        expect((await stored())?.retentionStage).toBe('notice')
    })

    it('does not restart the clock for a hold that ended before the account lapsed', async () => {
        await lapse(10)
        await setOverlay({ retentionHoldUntil: daysAgo(50) })

        await runRetentionSweep(NOW)

        expect((await stored())?.lapsedAt?.getTime()).toBe(daysAgo(10).getTime())
    })

    it('a free-forever account is never erased, grant or no grant', async () => {
        await readyToErase()
        await setOverlay({ grandfatherKind: 'free_forever' })

        expect((await runRetentionSweep(NOW)).deleted).toBe(0)
        expect(await userExists()).toBe(true)
    })
})
