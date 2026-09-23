import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import app from '@http/app'
import request from 'supertest'

import { Account } from '@modules/accounts'
import { Budget } from '@modules/budgets'
import { setMailTransport, type MailMessage } from '@infra/mail/mailService'
import { getUserEntitlements, runRetentionSweep, Subscription } from '@modules/billing'
import { SavingsGoal } from '@modules/savings-goals'
import { Transaction } from '@modules/transactions'
import { User } from '@modules/users'
import { disableBilling, enableBilling } from '@tests/billingHelpers'

import { DEFAULT_DEMO_EMAIL, DEFAULT_DEMO_PASSWORD, seedDemoAccount } from '../demoAccount.service'

const NOW = new Date('2026-09-23T12:00:00.000Z')

describe('seedDemoAccount', () => {
    afterEach(() => {
        disableBilling()
        delete process.env.SMTP_HOST
        delete process.env.DEMO_ACCOUNT_EMAIL
        delete process.env.DEMO_ACCOUNT_PASSWORD
        setMailTransport(null)
    })

    it('creates a demo user that can log in through the normal login flow', async () => {
        const result = await seedDemoAccount(NOW)

        expect(result.email).toBe(DEFAULT_DEMO_EMAIL)

        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: DEFAULT_DEMO_EMAIL, password: DEFAULT_DEMO_PASSWORD })

        expect(res.status).toBe(200)
        expect(res.body.data.user._id).toBe(result.userId)
    })

    it('respects DEMO_ACCOUNT_EMAIL/DEMO_ACCOUNT_PASSWORD overrides', async () => {
        process.env.DEMO_ACCOUNT_EMAIL = 'showcase@corvale.app'
        process.env.DEMO_ACCOUNT_PASSWORD = 'SomeOtherPassword1!'

        const result = await seedDemoAccount(NOW)

        expect(result.email).toBe('showcase@corvale.app')
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'showcase@corvale.app', password: 'SomeOtherPassword1!' })
        expect(res.status).toBe(200)
    })

    it('seeds accounts, transactions, budgets and a savings goal with consistent balances', async () => {
        const result = await seedDemoAccount(NOW)

        expect(result.accountsCreated).toBe(3)
        expect(result.transactionsCreated).toBeGreaterThan(0)
        expect(result.budgetsCreated).toBe(2)
        expect(result.savingsGoalsCreated).toBe(1)

        const accounts = await Account.find({ userId: result.userId }).lean()
        expect(accounts).toHaveLength(3)
        for (const account of accounts) {
            expect(Number.isFinite(account.currentBalance)).toBe(true)
        }

        const transactions = await Transaction.find({ userId: result.userId }).lean()
        expect(transactions.length).toBe(result.transactionsCreated)
        for (const transaction of transactions) {
            expect(transaction.date.getTime()).toBeLessThanOrEqual(NOW.getTime())
            expect(transaction.categoryId).toBeTruthy()
        }

        const budgets = await Budget.find({ userId: result.userId }).lean()
        expect(budgets).toHaveLength(2)

        const goals = await SavingsGoal.find({ userId: result.userId }).lean()
        expect(goals).toHaveLength(1)
    })

    it('is read-only via the existing entitlement gate, not a new enforcement path', async () => {
        enableBilling()
        const result = await seedDemoAccount(NOW)

        const entitlements = await getUserEntitlements(result.userId, NOW)

        expect(entitlements.canWrite).toBe(false)
        expect(entitlements.canRead).toBe(true)
        expect(entitlements.canExport).toBe(true)
    })

    it('is idempotent: re-running resets to a fresh state without accumulating data or duplicating the user', async () => {
        const first = await seedDemoAccount(NOW)
        const later = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
        const second = await seedDemoAccount(later)

        expect(second.userId).toBe(first.userId)
        expect(await User.countDocuments({ email: DEFAULT_DEMO_EMAIL })).toBe(1)
        expect(await Account.countDocuments({ userId: first.userId })).toBe(second.accountsCreated)
        expect(await Transaction.countDocuments({ userId: first.userId })).toBe(second.transactionsCreated)
        expect(await Budget.countDocuments({ userId: first.userId })).toBe(second.budgetsCreated)
        expect(await SavingsGoal.countDocuments({ userId: first.userId })).toBe(second.savingsGoalsCreated)
    })

    it('is never picked up by the dunning sweep (stored status is not past_due)', async () => {
        const result = await seedDemoAccount(NOW)

        const stored = await Subscription.findOne({ userId: result.userId }).lean()
        expect(stored?.status).toBe('cancelled')
        expect(stored?.grandfatherKind).toBeNull()
    })

    it('is excluded from the retention sweep despite being a lapsed (cancelled) subscription', async () => {
        enableBilling()
        process.env.SMTP_HOST = 'smtp.test.local'
        process.env.BILLING_RETENTION_ENABLED = 'true'
        const sent: MailMessage[] = []
        const sendMail: Mock<(message: MailMessage) => Promise<{ messageId: string }>> = vi.fn(async (message) => {
            sent.push(message)
            return { messageId: `m-${sent.length}` }
        })
        setMailTransport({ sendMail })

        const result = await seedDemoAccount(NOW)
        // Run the sweep far enough out that a real cancelled/lapsed account would be fully through
        // notice + erasure by now.
        const farFuture = new Date(NOW.getTime() + 400 * 24 * 60 * 60 * 1000)

        await runRetentionSweep(farFuture)

        expect(sendMail).not.toHaveBeenCalled()
        expect(await Subscription.findOne({ userId: result.userId }).lean()).not.toBeNull()
        expect(await User.findById(result.userId).lean()).not.toBeNull()

        delete process.env.BILLING_RETENTION_ENABLED
    })
})
