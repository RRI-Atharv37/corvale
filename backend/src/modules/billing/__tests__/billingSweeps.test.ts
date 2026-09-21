import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setMailTransport } from '@infra/mail/mailService'
import { Receipt } from '@modules/receipts'
import { Subscription, UsageCounter, recomputeAllUsageCounters, runBillingSweeps } from '@modules/billing'
import { seedUserDirectly } from '@tests/helpers'
import { DAY_MS, disableBilling, enableBilling, setSubscription } from '@tests/billingHelpers'

/**
 * M3e / M5 - the scheduled entry point. One run expires lapsed trials and sends the due dunning
 * emails; usage counters are only rebuilt on request (a heal after billing was switched off and
 * on). Nothing here schedules itself - an external cron runs `npm run sweep:billing`.
 */

const NOW = new Date('2026-10-10T12:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)
const userId = () => new Types.ObjectId().toString()

const sendMail = vi.fn().mockResolvedValue({ messageId: 'm' })

beforeEach(() => {
    process.env.SMTP_HOST = 'smtp.test.local'
    sendMail.mockClear()
    setMailTransport({ sendMail })
    enableBilling()
})

afterEach(() => {
    disableBilling()
    delete process.env.SMTP_HOST
    setMailTransport(null)
})

describe('runBillingSweeps', () => {
    it('expires lapsed trials and reports how many', async () => {
        const lapsed = userId()
        await setSubscription(lapsed, { status: 'trialing', trialEndsAt: daysAgo(1), currentPeriodEnd: null })

        const result = await runBillingSweeps(NOW)

        expect(result).toMatchObject({ skipped: false, trialsExpired: 1 })
        expect((await Subscription.findOne({ userId: lapsed }).lean())?.status).toBe('trial_expired')
    })

    it('runs the dunning sweep in the same pass', async () => {
        const user = await seedUserDirectly({ email: 'dunning-sweep@example.com' })
        await setSubscription(user.userId, { status: 'past_due', pastDueSince: daysAgo(1) })

        const result = await runBillingSweeps(NOW)

        expect(result.dunning).toMatchObject({ sent: 1, failed: 0 })
    })

    it('a failure in the dunning sweep does not stop trials from being expired', async () => {
        const lapsed = userId()
        await setSubscription(lapsed, { status: 'trialing', trialEndsAt: daysAgo(1), currentPeriodEnd: null })
        sendMail.mockRejectedValue(new Error('smtp down'))
        const user = await seedUserDirectly({ email: 'dunning-fail@example.com' })
        await setSubscription(user.userId, { status: 'past_due', pastDueSince: daysAgo(1) })

        const result = await runBillingSweeps(NOW)

        expect(result.trialsExpired).toBe(1)
        expect(result.dunning.failed).toBe(1)
        sendMail.mockResolvedValue({ messageId: 'm' })
    })

    it('does nothing while billing is off', async () => {
        disableBilling()
        await setSubscription(userId(), { status: 'trialing', trialEndsAt: daysAgo(1), currentPeriodEnd: null })

        const result = await runBillingSweeps(NOW)

        expect(result).toMatchObject({ skipped: true, trialsExpired: 0 })
        expect(await Subscription.countDocuments({ status: 'trial_expired' })).toBe(0)
    })
})

describe('recomputeAllUsageCounters', () => {
    it('rebuilds the counter of every user who has receipts, workspaces, devices or a counter already', async () => {
        const withReceipts = userId()
        const drifted = userId()
        await Receipt.create({
            userId: withReceipts,
            originalFilename: 'r.pdf',
            storedFilename: 'a.pdf',
            mimeType: 'application/pdf',
            size: 42,
        })
        await UsageCounter.create({ userId: drifted, resource: 'receiptBytes', value: 999 })

        const result = await recomputeAllUsageCounters()

        expect(result.users).toBe(2)
        expect((await UsageCounter.findOne({ userId: withReceipts, resource: 'receiptBytes' }).lean())?.value).toBe(42)
        expect((await UsageCounter.findOne({ userId: drifted, resource: 'receiptBytes' }).lean())?.value).toBe(0)
    })
})
