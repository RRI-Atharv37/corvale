import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { setMailTransport, type MailMessage } from '@infra/mail/mailService'
import { User } from '@modules/users'
import { Subscription, runBillingSweeps, sendLifecycleEmails } from '@modules/billing'
import { buildUnsubscribeToken } from '@modules/users/emailPreferences.service'
import { seedUserDirectly } from '@tests/helpers'
import { DAY_MS, disableBilling, enableBilling, setSubscription } from '@tests/billingHelpers'

/**
 * M9c - lifecycle email. The trial emails (day 0 / 7 / 21 / 28 / expiry) are transactional account
 * notices; the win-back is marketing and honours the unsubscribe. Same contract as dunning: one email
 * per stage, once each, a stage is recorded only after the send succeeds, and after downtime only the
 * latest due stage goes out.
 */

const ORIGIN = new Date('2026-10-01T12:00:00.000Z')
const at = (days: number) => new Date(ORIGIN.getTime() + days * DAY_MS)

let userId: string
let email: string
let sent: MailMessage[]
let sendMail: Mock<(message: MailMessage) => Promise<{ messageId: string }>>

const stored = () => Subscription.findOne({ userId }).lean()

const seedTrial = async (extra: Record<string, unknown> = {}) => {
    await setSubscription(userId, { status: 'trialing', trialEndsAt: at(30), currentPeriodEnd: null, ...extra })
    await Subscription.collection.updateOne({ userId: (await stored())?.userId }, { $set: { createdAt: ORIGIN } })
}

const seedLapsed = async (status: 'trial_expired' | 'cancelled', lapsedDaysBeforeNow: number, now: Date, extra: Record<string, unknown> = {}) => {
    await setSubscription(userId, {
        status,
        trialEndsAt: status === 'trial_expired' ? new Date(now.getTime() - lapsedDaysBeforeNow * DAY_MS) : null,
        currentPeriodEnd: status === 'cancelled' ? new Date(now.getTime() - lapsedDaysBeforeNow * DAY_MS) : null,
        lapsedAt: new Date(now.getTime() - lapsedDaysBeforeNow * DAY_MS),
        ...extra,
    })
}

beforeEach(async () => {
    process.env.SMTP_HOST = 'smtp.test.local'
    sent = []
    sendMail = vi.fn(async (message: MailMessage) => {
        sent.push(message)
        return { messageId: `m-${sent.length}` }
    })
    setMailTransport({ sendMail })

    enableBilling()
    const user = await seedUserDirectly({ email: 'lifecycle@example.com' })
    userId = user.userId
    email = user.email
})

afterEach(() => {
    disableBilling()
    delete process.env.SMTP_HOST
    setMailTransport(null)
})

describe('sendLifecycleEmails - trial', () => {
    it('sends the welcome email on the first run and records the stage', async () => {
        await seedTrial()

        const result = await sendLifecycleEmails(at(0.1))

        expect(result).toMatchObject({ skipped: false, sent: 1, failed: 0 })
        expect(sent).toHaveLength(1)
        expect(sent[0].to).toBe(email)
        expect((await stored())?.lifecycleEmailStage).toBe('trial_welcome')
    })

    it('sends each stage once as the trial runs down: day 0, 7, 21, 28 and expiry', async () => {
        await seedTrial()
        const subjects: string[] = []

        for (const day of [0.1, 1, 7, 10, 21, 25, 28, 29, 30, 31]) {
            await sendLifecycleEmails(at(day))
            await Subscription.updateOne({ userId }, { $set: { status: day >= 30 ? 'trial_expired' : 'trialing' } })
            if (sent.length > subjects.length) subjects.push(sent[sent.length - 1].subject)
        }

        expect(sent).toHaveLength(5)
        expect(new Set(subjects).size).toBe(5)
        expect((await stored())?.lifecycleEmailStage).toBe('trial_expired')
    })

    it('is idempotent: a second run in the same stage sends nothing', async () => {
        await seedTrial()

        await sendLifecycleEmails(at(1))
        const again = await sendLifecycleEmails(at(2))

        expect(again).toMatchObject({ sent: 0, failed: 0 })
        expect(sent).toHaveLength(1)
    })

    it('after downtime sends only the latest due stage', async () => {
        await seedTrial()

        await sendLifecycleEmails(at(22))

        expect(sent).toHaveLength(1)
        expect((await stored())?.lifecycleEmailStage).toBe('trial_day_21')
    })

    it('states the real number of days left and the trial end date', async () => {
        await seedTrial()

        await sendLifecycleEmails(at(21))

        expect(sent[0].text).toContain('9 days')
        expect(sent[0].text).toContain('31 October 2026')
    })

    it('does not record a stage when the send fails, so the next run retries it', async () => {
        await seedTrial()
        sendMail.mockRejectedValueOnce(new Error('smtp down'))

        const first = await sendLifecycleEmails(at(1))
        expect(first).toMatchObject({ sent: 0, failed: 1 })
        expect((await stored())?.lifecycleEmailStage ?? null).toBeNull()

        const second = await sendLifecycleEmails(at(1.5))
        expect(second).toMatchObject({ sent: 1, failed: 0 })
        expect((await stored())?.lifecycleEmailStage).toBe('trial_welcome')
    })

    it('does not put an unsubscribe link in a trial email - those are account notices', async () => {
        await seedTrial()

        await sendLifecycleEmails(at(1))

        expect(sent[0].html).not.toMatch(/unsubscribe/i)
        expect(sent[0].headers?.['List-Unsubscribe']).toBeUndefined()
    })

    it('skips an address that has not been verified, and sends once it is', async () => {
        await seedTrial()
        await User.updateOne({ _id: userId }, { $set: { isEmailVerified: false } })

        expect(await sendLifecycleEmails(at(1))).toMatchObject({ sent: 0 })
        expect((await stored())?.lifecycleEmailStage ?? null).toBeNull()

        await User.updateOne({ _id: userId }, { $set: { isEmailVerified: true } })
        expect(await sendLifecycleEmails(at(2))).toMatchObject({ sent: 1 })
    })

    it('leaves alone free-forever accounts and comped customers', async () => {
        await seedTrial({ grandfatherKind: 'free_forever' })
        expect(await sendLifecycleEmails(at(1))).toMatchObject({ sent: 0 })

        await seedTrial({ grandfatherKind: null })
        await Subscription.updateOne(
            { userId },
            { $set: { adminGrant: { kind: 'comp', planCode: null, until: at(90), limits: null, grantedBy: userId, grantedAt: at(0) } } }
        )
        expect(await sendLifecycleEmails(at(1))).toMatchObject({ sent: 0 })
    })

    it('ignores paying and past-due subscriptions', async () => {
        await setSubscription(userId, { status: 'active' })
        await Subscription.collection.updateOne({}, { $set: { createdAt: ORIGIN } })

        expect(await sendLifecycleEmails(at(8))).toMatchObject({ sent: 0 })
    })
})

describe('sendLifecycleEmails - win-back', () => {
    const NOW = at(100)

    it('sends nothing before the delay and one win-back after it', async () => {
        await seedLapsed('cancelled', 5, NOW)
        expect(await sendLifecycleEmails(NOW)).toMatchObject({ sent: 0 })

        await seedLapsed('cancelled', 15, NOW)
        expect(await sendLifecycleEmails(NOW)).toMatchObject({ sent: 1 })
        expect((await stored())?.lifecycleEmailStage).toBe('win_back')
    })

    it('sends it once only', async () => {
        await seedLapsed('cancelled', 15, NOW)

        await sendLifecycleEmails(NOW)
        await sendLifecycleEmails(at(101))

        expect(sent).toHaveLength(1)
    })

    it('carries a working unsubscribe link and a List-Unsubscribe header', async () => {
        await seedLapsed('cancelled', 15, NOW)

        await sendLifecycleEmails(NOW)

        const token = buildUnsubscribeToken(userId)
        expect(sent[0].html).toContain(`/unsubscribe?token=${token}`)
        expect(sent[0].text).toContain(`/unsubscribe?token=${token}`)
        expect(sent[0].headers?.['List-Unsubscribe']).toContain(`/unsubscribe?token=${token}`)
    })

    it('respects an opt-out: nothing is sent and the stage is recorded so it is not re-evaluated daily', async () => {
        await User.updateOne({ _id: userId }, { $set: { 'emailPreferences.marketing': false } })
        await seedLapsed('trial_expired', 20, NOW)

        const result = await sendLifecycleEmails(NOW)

        expect(result).toMatchObject({ sent: 0, failed: 0, optedOut: 1 })
        expect(sent).toHaveLength(0)
        expect((await stored())?.lifecycleEmailStage).toBe('win_back')
    })

    it('is not sent to an account held out of retention (an erasure hold, or the demo account)', async () => {
        await seedLapsed('cancelled', 15, NOW, {})
        await Subscription.updateOne({ userId }, { $set: { retentionHoldUntil: at(4000) } })

        expect(await sendLifecycleEmails(NOW)).toMatchObject({ sent: 0 })
    })

    it('sends the trial-expired email first for a trial that just lapsed', async () => {
        await seedLapsed('trial_expired', 1, NOW)

        await sendLifecycleEmails(NOW)

        expect(sent).toHaveLength(1)
        expect((await stored())?.lifecycleEmailStage).toBe('trial_expired')
    })
})

describe('sendLifecycleEmails - switches', () => {
    it('does nothing while billing is off', async () => {
        await seedTrial()
        disableBilling()

        expect(await sendLifecycleEmails(at(1))).toEqual({ skipped: true, sent: 0, failed: 0, optedOut: 0 })
        expect(sent).toHaveLength(0)
    })

    it('sends nothing and records nothing when SMTP is not configured', async () => {
        await seedTrial()
        delete process.env.SMTP_HOST

        expect(await sendLifecycleEmails(at(1))).toMatchObject({ skipped: false, sent: 0 })
        expect((await stored())?.lifecycleEmailStage ?? null).toBeNull()
    })
})

describe('runBillingSweeps', () => {
    it('runs the lifecycle sweep in the same pass and reports it', async () => {
        await seedTrial()

        const result = await runBillingSweeps(at(0.5))

        expect(result.lifecycle).toMatchObject({ sent: 1 })
        expect(sent).toHaveLength(1)
    })
})
