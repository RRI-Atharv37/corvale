import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import app from '@http/app'
import { setMailTransport, type MailMessage } from '@infra/mail/mailService'
import { setLoggerWriter } from '@infra/observability/logger'
import {
    Subscription,
    applyBillingEvent,
    getPastDueGraceDays,
    getUserEntitlements,
    sendDunningEmails,
    type NormalizedBillingEvent,
} from '@modules/billing'
import { DEFAULT_PAST_DUE_GRACE_DAYS } from '@core/billing/entitlements'
import { registerUser, type RegisteredUser } from '@tests/helpers'
import { DAY_MS, disableBilling, enableBilling, setSubscription } from '@tests/billingHelpers'

/**
 * M3e - dunning. The provider owns the card retries; Corvale owns what the user is told and when
 * access stops. `payment.failed` puts a subscription in `past_due` (M3c); this sweep sends one email
 * per stage as the grace window runs down, exactly once each, and never resurrects a stage after the
 * user pays. Read-only once the window closes is derived by the resolver, not by this sweep.
 */

const ORIGIN = new Date('2026-10-01T12:00:00.000Z')
const at = (days: number) => new Date(ORIGIN.getTime() + days * DAY_MS)

let user: RegisteredUser
let sent: MailMessage[]
let sendMail: Mock<(message: MailMessage) => Promise<{ messageId: string }>>

const stored = () => Subscription.findOne({ userId: user.userId }).lean()

const seedPastDue = (extra: Record<string, unknown> = {}) =>
    setSubscription(user.userId, { status: 'past_due', pastDueSince: ORIGIN, ...extra })

beforeEach(async () => {
    process.env.SMTP_HOST = 'smtp.test.local'
    sent = []
    sendMail = vi.fn(async (message: MailMessage) => {
        sent.push(message)
        return { messageId: `m-${sent.length}` }
    })
    setMailTransport({ sendMail })

    enableBilling()
    user = await registerUser(app)
    await Subscription.deleteMany({})
    sendMail.mockClear()
    sent = []
})

afterEach(() => {
    disableBilling()
    delete process.env.SMTP_HOST
    delete process.env.BILLING_PAST_DUE_GRACE_DAYS
    setMailTransport(null)
})

describe('sendDunningEmails - the escalation', () => {
    it('sends the payment-failed email on the first run after the failure', async () => {
        await seedPastDue()

        const result = await sendDunningEmails(at(0.01))

        expect(result).toMatchObject({ sent: 1, failed: 0 })
        expect(sent).toHaveLength(1)
        expect(sent[0].to).toBe(user.email)
        expect((await stored())?.dunningStage).toBe('payment_failed')
    })

    it('sends each stage once as the window runs down: day 0, 3, 6 and 7', async () => {
        await seedPastDue()
        const subjects: string[] = []

        for (const day of [0.1, 1, 3, 3.5, 6, 6.9, 7, 20]) {
            await sendDunningEmails(at(day))
            if (sent.length > subjects.length) subjects.push(sent[sent.length - 1].subject)
        }

        expect(sent).toHaveLength(4)
        expect(new Set(subjects).size).toBe(4)
        expect((await stored())?.dunningStage).toBe('access_paused')
    })

    it('is idempotent: a second run in the same stage sends nothing', async () => {
        await seedPastDue()

        await sendDunningEmails(at(1))
        const again = await sendDunningEmails(at(2))

        expect(again.sent).toBe(0)
        expect(sent).toHaveLength(1)
    })

    it('after downtime it sends only the latest due stage, not every missed one', async () => {
        await seedPastDue()

        await sendDunningEmails(at(6.5))

        expect(sent).toHaveLength(1)
        expect((await stored())?.dunningStage).toBe('final_warning')
    })

    it('names the day access becomes read-only and links to billing, until it has', async () => {
        await seedPastDue()

        await sendDunningEmails(at(0.5))

        expect(sent[0].html).toContain('8 October 2026')
        expect(sent[0].html).toContain('/settings/billing')
        expect(sent[0].text).toContain('/settings/billing')
    })

    it('the last email says the account is now read-only and that the data and export are untouched', async () => {
        await seedPastDue()

        await sendDunningEmails(at(7.5))

        expect(sent[0].html).toMatch(/read-only/i)
        expect(sent[0].html).toMatch(/export/i)
    })

    it('follows the configured grace window', async () => {
        process.env.BILLING_PAST_DUE_GRACE_DAYS = '14'
        await seedPastDue()

        await sendDunningEmails(at(7))

        expect((await stored())?.dunningStage).toBe('reminder')
    })
})

describe('sendDunningEmails - who is left alone', () => {
    it.each(['active', 'trialing', 'trial_expired', 'cancelled'] as const)('never emails a %s subscription', async (status) => {
        await setSubscription(user.userId, { status, pastDueSince: null })

        const result = await sendDunningEmails(at(3))

        expect(result.sent).toBe(0)
        expect(sendMail).not.toHaveBeenCalled()
    })

    it('never emails a free_forever account, whatever its stored status', async () => {
        await seedPastDue({ grandfatherKind: 'free_forever' })

        await sendDunningEmails(at(3))

        expect(sendMail).not.toHaveBeenCalled()
    })

    it('skips a past_due row that has no start date rather than guessing', async () => {
        await setSubscription(user.userId, { status: 'past_due', pastDueSince: null })

        await sendDunningEmails(at(3))

        expect(sendMail).not.toHaveBeenCalled()
    })

    it('skips a subscription whose user no longer exists', async () => {
        await seedPastDue()
        const { User } = await import('@modules/users')
        await User.deleteOne({ _id: user.userId })

        const result = await sendDunningEmails(at(3))

        expect(result).toMatchObject({ sent: 0, failed: 0 })
    })

    it('does nothing at all while billing is off', async () => {
        await seedPastDue()
        disableBilling()

        const result = await sendDunningEmails(at(3))

        expect(result).toMatchObject({ sent: 0, failed: 0, skipped: true })
        expect(sendMail).not.toHaveBeenCalled()
    })
})

describe('sendDunningEmails - delivery problems', () => {
    it('leaves the stage unrecorded when the send fails, so the next run retries it', async () => {
        await seedPastDue()
        sendMail.mockRejectedValueOnce(new Error('smtp down'))

        const first = await sendDunningEmails(at(1))
        const second = await sendDunningEmails(at(1.1))

        expect(first).toMatchObject({ sent: 0, failed: 1 })
        expect(second).toMatchObject({ sent: 1, failed: 0 })
        expect((await stored())?.dunningStage).toBe('payment_failed')
    })

    it('one failing recipient does not stop the others', async () => {
        const second = await registerUser(app)
        await Subscription.deleteMany({})
        await seedPastDue()
        await setSubscription(second.userId, { status: 'past_due', pastDueSince: ORIGIN })
        sendMail.mockRejectedValueOnce(new Error('bounced'))

        const result = await sendDunningEmails(at(1))

        expect(result).toMatchObject({ sent: 1, failed: 1 })
    })

    it('records nothing and reports it when SMTP is not configured', async () => {
        delete process.env.SMTP_HOST
        await seedPastDue()

        const result = await sendDunningEmails(at(1))

        expect(result.sent).toBe(0)
        expect(sendMail).not.toHaveBeenCalled()
        expect((await stored())?.dunningStage ?? null).toBeNull()
    })

    it('logs the failure without a user id, an email address or a provider id', async () => {
        await seedPastDue()
        sendMail.mockRejectedValueOnce(new Error('smtp down'))
        const lines: string[] = []
        setLoggerWriter((line) => lines.push(line))

        await sendDunningEmails(at(1))
        setLoggerWriter(null)

        const logged = lines.join(' ')
        expect(logged).toContain('Dunning email failed')
        expect(logged).not.toContain(user.userId)
        expect(logged).not.toContain(user.email)
        expect(logged).not.toContain(`cus_${user.userId}`)
    })
})

describe('recovery clears the escalation', () => {
    let counter = 0
    const event = (overrides: Partial<NormalizedBillingEvent>): NormalizedBillingEvent => {
        counter += 1
        return {
            providerEventId: `evt_dunning_${counter}`,
            type: 'payment.succeeded',
            occurredAt: new Date(Date.now() + counter),
            providerCustomerId: `cus_${user.userId}`,
            providerSubscriptionId: `sub_${user.userId}`,
            ...overrides,
        }
    }

    it('payment.succeeded resets the stage, so a later failure starts over at day 0', async () => {
        await seedPastDue()
        await sendDunningEmails(at(3))
        expect((await stored())?.dunningStage).toBe('reminder')

        await applyBillingEvent(event({ type: 'payment.succeeded' }))
        const recovered = await stored()
        expect(recovered?.status).toBe('active')
        expect(recovered?.dunningStage ?? null).toBeNull()

        await setSubscription(user.userId, { status: 'past_due', pastDueSince: at(10) })
        sent.length = 0
        await sendDunningEmails(at(10.1))

        expect(sent).toHaveLength(1)
        expect((await stored())?.dunningStage).toBe('payment_failed')
    })

    it.each([
        ['subscription.updated', { status: 'active' as const }],
        ['subscription.deleted', {}],
    ] as const)('%s clears the stage', async (type, extra) => {
        await seedPastDue()
        await sendDunningEmails(at(3))

        await applyBillingEvent(event({ type, ...extra }))

        expect((await stored())?.dunningStage ?? null).toBeNull()
    })

    it('payment.failed keeps a running escalation instead of restarting it', async () => {
        await seedPastDue()
        await sendDunningEmails(at(3))

        await applyBillingEvent(event({ type: 'payment.failed', occurredAt: at(4) }))

        const row = await stored()
        expect(row?.dunningStage).toBe('reminder')
        expect(row?.pastDueSince?.getTime()).toBe(ORIGIN.getTime())
    })
})

describe('the grace window governs write access too', () => {
    it('stays writable inside the window and turns read-only the moment it closes', async () => {
        await seedPastDue()

        const inside = await getUserEntitlements(user.userId, at(6.9))
        const closed = await getUserEntitlements(user.userId, at(7))

        expect(inside).toMatchObject({ status: 'past_due', canWrite: true })
        expect(closed).toMatchObject({ status: 'past_due', canWrite: false })
        expect(closed.canRead).toBe(true)
        expect(closed.canExport).toBe(true)
    })

    it('honours BILLING_PAST_DUE_GRACE_DAYS', async () => {
        process.env.BILLING_PAST_DUE_GRACE_DAYS = '14'
        await seedPastDue()

        expect((await getUserEntitlements(user.userId, at(10))).canWrite).toBe(true)
        expect((await getUserEntitlements(user.userId, at(14))).canWrite).toBe(false)
    })
})

describe('getPastDueGraceDays', () => {
    it('defaults to the built-in window', () => {
        expect(getPastDueGraceDays()).toBe(DEFAULT_PAST_DUE_GRACE_DAYS)
    })

    it('reads BILLING_PAST_DUE_GRACE_DAYS', () => {
        process.env.BILLING_PAST_DUE_GRACE_DAYS = '10'

        expect(getPastDueGraceDays()).toBe(10)
    })

    it.each(['0', '2', '61', '-3', '4.5', 'soon', ''])('falls back to the default for %j', (value) => {
        process.env.BILLING_PAST_DUE_GRACE_DAYS = value

        expect(getPastDueGraceDays()).toBe(DEFAULT_PAST_DUE_GRACE_DAYS)
    })
})
