import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import app from '@http/app'
import { setMailTransport, type MailMessage } from '@infra/mail/mailService'
import { Account } from '@modules/accounts'
import { Transaction } from '@modules/transactions'
import { User } from '@modules/users'
import { Workspace } from '@modules/workspaces'
import { Subscription, getRetentionDays, isRetentionEnabled, runRetentionSweep, runBillingSweeps } from '@modules/billing'
import { DEFAULT_RETENTION_DAYS } from '@core/billing/retention'
import { registerUser, seedUserDirectly, type RegisteredUser } from '@tests/helpers'
import {
    DAY_MS,
    createAccountViaApi,
    createExpenseViaApi,
    disableBilling,
    enableBilling,
    getFoodMasterId,
    seedWorkspace,
    setSubscription,
} from '@tests/billingHelpers'

/**
 * M5c - the retention window. A lapsed account (`cancelled` / `trial_expired`) is a read-only archive
 * for a stated number of days. Inside the window nothing is touched and reactivation restores
 * everything; at the end of it the account is erased exactly as a user-initiated deletion would erase
 * it - but never without a warning that was actually delivered, never for anyone who is not lapsed,
 * and never while `BILLING_RETENTION_ENABLED` is off (the window is not in the Terms until M0).
 */

const NOW = new Date('2027-01-01T12:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)
const daysAfter = (days: number) => new Date(NOW.getTime() + days * DAY_MS)

let user: RegisteredUser
let sent: MailMessage[]
let sendMail: Mock<(message: MailMessage) => Promise<{ messageId: string }>>

const stored = (userId = user.userId) => Subscription.findOne({ userId }).lean()

const lapse = (days: number, extra: Record<string, unknown> = {}, userId = user.userId) =>
    setSubscription(userId, {
        status: 'cancelled',
        currentPeriodEnd: daysAgo(days),
        lapsedAt: daysAgo(days),
        ...extra,
    })

beforeEach(async () => {
    process.env.SMTP_HOST = 'smtp.test.local'
    process.env.BILLING_RETENTION_ENABLED = 'true'
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
    delete process.env.BILLING_RETENTION_ENABLED
    delete process.env.BILLING_RETENTION_DAYS
    setMailTransport(null)
})

describe('configuration', () => {
    it('is off unless BILLING_RETENTION_ENABLED is exactly "true"', () => {
        expect(isRetentionEnabled()).toBe(true)
        process.env.BILLING_RETENTION_ENABLED = '1'
        expect(isRetentionEnabled()).toBe(false)
        delete process.env.BILLING_RETENTION_ENABLED
        expect(isRetentionEnabled()).toBe(false)
    })

    it('reads BILLING_RETENTION_DAYS and falls back to the default when it is missing or out of range', () => {
        process.env.BILLING_RETENTION_DAYS = '365'
        expect(getRetentionDays()).toBe(365)

        for (const bad of ['0', '10', '99999', 'soon', '90.5', '']) {
            process.env.BILLING_RETENTION_DAYS = bad
            expect(getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS)
        }
        delete process.env.BILLING_RETENTION_DAYS
        expect(getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS)
    })
})

describe('runRetentionSweep - when it does nothing', () => {
    it('skips entirely while billing is off', async () => {
        await lapse(1000)
        disableBilling()

        const result = await runRetentionSweep(NOW)

        expect(result.skipped).toBe(true)
        expect(await User.countDocuments({ _id: user.userId })).toBe(1)
        expect(sent).toHaveLength(0)
    })

    it('sends nothing and deletes nothing while retention is off, however long ago the lapse was', async () => {
        delete process.env.BILLING_RETENTION_ENABLED
        await lapse(1000, { retentionStage: 'final_warning', retentionStageAt: daysAgo(900) })

        const result = await runRetentionSweep(NOW)

        expect(result).toMatchObject({ notified: 0, deleted: 0 })
        expect(sent).toHaveLength(0)
        expect(await User.countDocuments({ _id: user.userId })).toBe(1)
    })
})

describe('runRetentionSweep - keeping lapsedAt true to the status', () => {
    it('stamps lapsedAt on a lapsed row that has none, from the trial end or the period end', async () => {
        const cancelled = await seedUserDirectly({ email: 'ret-cancelled@example.com' })
        await setSubscription(user.userId, { status: 'trial_expired', trialEndsAt: daysAgo(40), currentPeriodEnd: null })
        await setSubscription(cancelled.userId, { status: 'cancelled', currentPeriodEnd: daysAgo(20) })

        const result = await runRetentionSweep(NOW)

        expect(result.stamped).toBe(2)
        expect((await stored())?.lapsedAt).toEqual(daysAgo(40))
        expect((await stored(cancelled.userId))?.lapsedAt).toEqual(daysAgo(20))
    })

    it('stamps even while retention is off, so the clock is right the day it is switched on', async () => {
        delete process.env.BILLING_RETENTION_ENABLED
        await setSubscription(user.userId, { status: 'trial_expired', trialEndsAt: daysAgo(40), currentPeriodEnd: null })

        await runRetentionSweep(NOW)

        expect((await stored())?.lapsedAt).toEqual(daysAgo(40))
    })

    it('never moves a lapsedAt that is already set', async () => {
        await lapse(10, { currentPeriodEnd: daysAgo(500) })

        await runRetentionSweep(NOW)

        expect((await stored())?.lapsedAt).toEqual(daysAgo(10))
    })

    it('clears the lapse and the notice history when the account is reactivated', async () => {
        await lapse(50, { retentionStage: 'reminder', retentionStageAt: daysAgo(20) })
        await setSubscription(user.userId, { status: 'active' })

        const result = await runRetentionSweep(NOW)

        expect(result.cleared).toBe(1)
        expect(await stored()).toMatchObject({ lapsedAt: null, retentionStage: null, retentionStageAt: null })
    })

    it('starts a fresh window if the account lapses a second time', async () => {
        await lapse(50, { retentionStage: 'notice', retentionStageAt: daysAgo(50) })
        await setSubscription(user.userId, { status: 'active' })
        await runRetentionSweep(NOW)
        await setSubscription(user.userId, { status: 'cancelled', currentPeriodEnd: daysAfter(1) })

        await runRetentionSweep(NOW)

        const row = await stored()
        expect(row?.lapsedAt).toEqual(NOW)
        expect(row?.retentionStage).toBeNull()
    })
})

describe('runRetentionSweep - the notices', () => {
    it('sends the first notice as soon as an account lapses, naming the deletion date and offering an export', async () => {
        await lapse(1)

        const result = await runRetentionSweep(NOW)

        expect(result).toMatchObject({ notified: 1, failed: 0, deleted: 0 })
        expect(sent).toHaveLength(1)
        expect(sent[0].to).toBe(user.email)
        const endsOn = daysAfter(DEFAULT_RETENTION_DAYS - 1).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
        })
        expect(sent[0].html).toContain(endsOn)
        expect(sent[0].html.toLowerCase()).toContain('export')
        expect(await stored()).toMatchObject({ retentionStage: 'notice' })
    })

    it('sends each stage exactly once', async () => {
        await lapse(1)

        await runRetentionSweep(NOW)
        await runRetentionSweep(new Date(NOW.getTime() + 60_000))

        expect(sent).toHaveLength(1)
    })

    it('escalates through the reminder and the final warning as the window runs down', async () => {
        await lapse(1)
        await runRetentionSweep(NOW)

        await runRetentionSweep(daysAfter(150 - 1))
        expect((await stored())?.retentionStage).toBe('reminder')

        await runRetentionSweep(daysAfter(173 - 1))
        expect((await stored())?.retentionStage).toBe('final_warning')
        expect(sent).toHaveLength(3)
    })

    it('after downtime sends only the latest due stage', async () => {
        await lapse(175)

        await runRetentionSweep(NOW)

        expect(sent).toHaveLength(1)
        expect((await stored())?.retentionStage).toBe('final_warning')
    })

    it('records a stage only after its email was delivered, and retries the next run', async () => {
        await lapse(1)
        sendMail.mockRejectedValueOnce(new Error('smtp down'))

        const first = await runRetentionSweep(NOW)

        expect(first).toMatchObject({ notified: 0, failed: 1 })
        expect((await stored())?.retentionStage).toBeNull()

        const second = await runRetentionSweep(NOW)

        expect(second).toMatchObject({ notified: 1, failed: 0 })
        expect((await stored())?.retentionStage).toBe('notice')
    })

    it('records nothing and warns when SMTP is not configured', async () => {
        delete process.env.SMTP_HOST
        await lapse(1)

        const result = await runRetentionSweep(NOW)

        expect(result).toMatchObject({ notified: 0, failed: 0 })
        expect((await stored())?.retentionStage).toBeNull()
    })

    it('does not write a stage over one that was cleared by a reactivation while the email was in flight', async () => {
        await lapse(1)
        sendMail.mockImplementationOnce(async (message) => {
            sent.push(message)
            await setSubscription(user.userId, { status: 'active' })
            return { messageId: 'm' }
        })

        await runRetentionSweep(NOW)

        expect((await stored())?.retentionStage).toBeNull()
    })

    it('emails only lapsed accounts', async () => {
        const others = ['trialing', 'active', 'past_due'] as const
        for (const status of others) {
            const other = await seedUserDirectly({ email: `ret-${status}@example.com` })
            await setSubscription(other.userId, { status, pastDueSince: status === 'past_due' ? daysAgo(400) : null })
        }

        await runRetentionSweep(NOW)

        expect(sent).toHaveLength(0)
    })

    it('leaves a free_forever account alone even if it somehow looks lapsed', async () => {
        await lapse(1000, { grandfatherKind: 'free_forever' })

        await runRetentionSweep(NOW)

        expect(sent).toHaveLength(0)
        expect(await User.countDocuments({ _id: user.userId })).toBe(1)
    })
})

describe('runRetentionSweep - deletion at the end of the window', () => {
    let accountId: string

    beforeEach(async () => {
        await setSubscription(user.userId, { status: 'active' })
        accountId = await createAccountViaApi(app, user.token)
        const categoryId = await getFoodMasterId(app, user.token)
        expect((await createExpenseViaApi(app, user.token, accountId, categoryId)).status).toBe(201)
        sendMail.mockClear()
        sent = []
    })

    const finalWarned = (lapsedDaysAgo: number, warnedDaysAgo: number) =>
        lapse(lapsedDaysAgo, { retentionStage: 'final_warning', retentionStageAt: daysAgo(warnedDaysAgo) })

    it('erases the account and everything it owns once the window has ended and the final warning is a week old', async () => {
        await finalWarned(181, 8)

        const result = await runRetentionSweep(NOW)

        expect(result.deleted).toBe(1)
        expect(await User.countDocuments({ _id: user.userId })).toBe(0)
        expect(await Account.countDocuments({ userId: user.userId })).toBe(0)
        expect(await Transaction.countDocuments({ userId: user.userId })).toBe(0)
        expect(await Subscription.countDocuments({ userId: user.userId })).toBe(0)
    })

    it('does not touch anyone else', async () => {
        const bystander = await registerUser(app, { email: 'ret-bystander@example.com' })
        await setSubscription(bystander.userId, { status: 'active' })
        await createAccountViaApi(app, bystander.token)
        await finalWarned(181, 8)

        await runRetentionSweep(NOW)

        expect(await User.countDocuments({ _id: bystander.userId })).toBe(1)
        expect(await Account.countDocuments({ userId: bystander.userId })).toBe(1)
        expect(await Subscription.countDocuments({ userId: bystander.userId })).toBe(1)
    })

    it('never deletes inside the window, even with a final warning on record', async () => {
        await finalWarned(179, 8)

        const result = await runRetentionSweep(NOW)

        expect(result.deleted).toBe(0)
        expect(await User.countDocuments({ _id: user.userId })).toBe(1)
    })

    it('never deletes an account that has not been sent the final warning', async () => {
        await lapse(1000, { retentionStage: 'reminder', retentionStageAt: daysAgo(900) })

        const result = await runRetentionSweep(NOW)

        expect(result.deleted).toBe(0)
        expect(await User.countDocuments({ _id: user.userId })).toBe(1)
        expect((await stored())?.retentionStage).toBe('final_warning')
        expect(sent).toHaveLength(1)
    })

    it('waits a full week after a late final warning before deleting', async () => {
        await lapse(1000)

        await runRetentionSweep(NOW)
        expect((await runRetentionSweep(daysAfter(6.9))).deleted).toBe(0)
        expect(await User.countDocuments({ _id: user.userId })).toBe(1)

        expect((await runRetentionSweep(daysAfter(7))).deleted).toBe(1)
        expect(await User.countDocuments({ _id: user.userId })).toBe(0)
    })

    it('never deletes a lapsed row that was reactivated after it was read', async () => {
        await finalWarned(181, 8)
        const reactivatedMidSweep = {
            select: () => ({
                lean: async () => {
                    await setSubscription(user.userId, { status: 'active' })
                    return { email: user.email }
                },
            }),
        }
        const spy = vi.spyOn(User, 'findById').mockReturnValueOnce(reactivatedMidSweep as never)

        const result = await runRetentionSweep(NOW)
        spy.mockRestore()

        expect(result.deleted).toBe(0)
        expect(await User.countDocuments({ _id: user.userId })).toBe(1)
    })

    it.each(['trialing', 'active', 'past_due'] as const)('never deletes a %s account', async (status) => {
        await setSubscription(user.userId, {
            status,
            pastDueSince: status === 'past_due' ? daysAgo(1000) : null,
            retentionStage: 'final_warning',
            retentionStageAt: daysAgo(900),
            lapsedAt: daysAgo(1000),
        })

        const result = await runRetentionSweep(NOW)

        expect(result.deleted).toBe(0)
        expect(await User.countDocuments({ _id: user.userId })).toBe(1)
    })

    it('never deletes a free_forever account', async () => {
        await finalWarned(1000, 900)
        await Subscription.updateOne({ userId: user.userId }, { $set: { grandfatherKind: 'free_forever' } })

        const result = await runRetentionSweep(NOW)

        expect(result.deleted).toBe(0)
        expect(await User.countDocuments({ _id: user.userId })).toBe(1)
    })

    it('leaves the sole owner of a workspace that still has members alone and reports it as blocked', async () => {
        const member = await seedUserDirectly({ email: 'ret-member@example.com' })
        const workspaceId = await seedWorkspace(user.userId, [{ userId: member.userId, role: 'editor' }])
        await finalWarned(181, 8)

        const result = await runRetentionSweep(NOW)

        expect(result).toMatchObject({ deleted: 0, blocked: 1 })
        expect(await User.countDocuments({ _id: user.userId })).toBe(1)
        expect(await Workspace.countDocuments({ _id: workspaceId })).toBe(1)
    })

    it('one account failing to erase does not stop the rest of the sweep', async () => {
        const member = await seedUserDirectly({ email: 'ret-member2@example.com' })
        await seedWorkspace(user.userId, [{ userId: member.userId, role: 'editor' }])
        await finalWarned(181, 8)
        const second = await seedUserDirectly({ email: 'ret-second@example.com' })
        await lapse(181, { retentionStage: 'final_warning', retentionStageAt: daysAgo(8) }, second.userId)

        const result = await runRetentionSweep(NOW)

        expect(result).toMatchObject({ deleted: 1, blocked: 1 })
        expect(await User.countDocuments({ _id: second.userId })).toBe(0)
    })
})

describe('reactivation inside the window restores full state', () => {
    it('keeps every record, lifts the read-only lock and forgets the notices', async () => {
        await setSubscription(user.userId, { status: 'active' })
        const accountId = await createAccountViaApi(app, user.token)
        const categoryId = await getFoodMasterId(app, user.token)
        expect((await createExpenseViaApi(app, user.token, accountId, categoryId)).status).toBe(201)

        await lapse(160)
        await runRetentionSweep(NOW)
        await runRetentionSweep(daysAfter(15))
        expect((await stored())?.retentionStage).toBe('reminder')
        expect((await createExpenseViaApi(app, user.token, accountId, categoryId)).status).toBe(402)

        await setSubscription(user.userId, { status: 'active' })
        await runRetentionSweep(daysAfter(16))

        expect(await stored()).toMatchObject({ lapsedAt: null, retentionStage: null })
        expect(await Transaction.countDocuments({ userId: user.userId })).toBe(1)
        expect((await createExpenseViaApi(app, user.token, accountId, categoryId)).status).toBe(201)
        expect(await Transaction.countDocuments({ userId: user.userId })).toBe(2)
    })
})

describe('runBillingSweeps includes retention', () => {
    it('reports the retention result alongside trials and dunning', async () => {
        await lapse(1)

        const result = await runBillingSweeps(NOW)

        expect(result.retention).toMatchObject({ skipped: false, notified: 1, deleted: 0 })
    })

    it('reports retention as skipped while billing is off', async () => {
        disableBilling()

        const result = await runBillingSweeps(NOW)

        expect(result.retention).toMatchObject({ skipped: true, deleted: 0 })
    })
})
