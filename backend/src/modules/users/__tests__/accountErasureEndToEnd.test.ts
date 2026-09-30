import request from 'supertest'
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import app from '@http/app'
import { AdminAuditLog, recordAudit } from '@modules/admin'
import RefreshToken from '@modules/auth/refreshToken.model'
import { createRefreshToken } from '@modules/auth/refreshToken.service'
import { BillingEvent, DeferredRevenueEntry, Subscription, resetBillingProvider } from '@modules/billing'
import { User } from '@modules/users'
import { authHeader, registerUser } from '@tests/helpers'
import { BILLING_STATES, disableBilling, enableBilling, setSubscription } from '@tests/billingHelpers'

/**
 * BUG-41 / SEC-70 - `DELETE /auth/account` used to erase the financial data and then fail on the
 * sanctioned append-only rewrites, leaving the `User` row, its password hash and its sessions behind.
 */

const PASSWORD = 'DeleteMeNow123!'
let eventCounter = 0
const oid = (): Types.ObjectId => new Types.ObjectId()

const deleteAccount = (token: string) =>
    request(app).delete('/api/v1/auth/account').set(authHeader(token)).send({ password: PASSWORD })

const seedLedgerFor = async (customer: string, subscription: string): Promise<string> => {
    const providerEventId = `evt_e2e_${++eventCounter}`
    await BillingEvent.create({
        providerEventId,
        type: 'payment.succeeded',
        occurredAt: new Date(),
        payload: { providerCustomerId: customer, providerSubscriptionId: subscription, total: 600, currency: 'USD' },
        processedAt: new Date(),
    })
    return providerEventId
}

beforeEach(() => enableBilling())
afterEach(() => {
    disableBilling()
    resetBillingProvider()
    vi.restoreAllMocks()
})

describe('DELETE /auth/account end to end', () => {
    it('removes the user, every refresh token, the ledger ids and the audit links', async () => {
        const { userId, token } = await registerUser(app, { email: 'e2e-erase@example.com', password: PASSWORD })
        await createRefreshToken(userId)
        await setSubscription(userId, { ...BILLING_STATES.cancelled, providerCustomerId: 'cus_e2e', providerSubscriptionId: 'sub_e2e' })
        await seedLedgerFor('cus_e2e', 'sub_e2e')
        await recordAudit({
            adminId: oid(),
            adminRole: 'support',
            action: 'trial.extended',
            subjectUserId: new Types.ObjectId(userId),
            reason: 'Trial extension after a sync bug',
        })
        expect(await RefreshToken.countDocuments({ userId })).toBeGreaterThan(0)

        const res = await deleteAccount(token)

        expect(res.status).toBe(200)
        expect(await User.findById(userId)).toBeNull()
        expect(await RefreshToken.countDocuments({ userId })).toBe(0)
        expect(await Subscription.countDocuments({ userId })).toBe(0)
        expect(await BillingEvent.countDocuments({ 'payload.providerSubscriptionId': 'sub_e2e' })).toBe(0)
        expect(await BillingEvent.countDocuments({ 'payload.providerCustomerId': 'cus_e2e' })).toBe(0)
        expect(await AdminAuditLog.countDocuments({ subjectUserId: userId })).toBe(0)
        expect(await AdminAuditLog.countDocuments({ reason: 'Trial extension after a sync bug' })).toBe(0)
    })

    it('erases a user who has no subscription row and no audit history', async () => {
        const { userId, token } = await registerUser(app, { email: 'e2e-plain@example.com', password: PASSWORD })

        expect((await deleteAccount(token)).status).toBe(200)

        expect(await User.findById(userId)).toBeNull()
        expect(await RefreshToken.countDocuments({ userId })).toBe(0)
    })

    it('leaves nothing that carries the erased subscription id, including the deferred-revenue ledger', async () => {
        const { userId, token } = await registerUser(app, { email: 'e2e-deferred@example.com', password: PASSWORD })
        await setSubscription(userId, { ...BILLING_STATES.cancelled, providerCustomerId: 'cus_def', providerSubscriptionId: 'sub_def' })
        const sourceEventId = await seedLedgerFor('cus_def', 'sub_def')
        await DeferredRevenueEntry.create({
            sourceEventId,
            planCode: 'pro',
            bucketIndex: 1,
            recognitionMonth: '2026-10',
            recognizedAmountMinor: 500,
            currency: 'usd',
            paymentOccurredAt: new Date('2026-10-01T00:00:00.000Z'),
        })

        expect((await deleteAccount(token)).status).toBe(200)

        const dump = JSON.stringify([
            await BillingEvent.collection.find({}).toArray(),
            await DeferredRevenueEntry.collection.find({}).toArray(),
        ])
        expect(dump).not.toContain('sub_def')
        expect(dump).not.toContain('cus_def')
    })

    it('a redaction failure leaves the account whole, so the user can retry instead of being half-erased', async () => {
        const { userId, token } = await registerUser(app, { email: 'e2e-retry@example.com', password: PASSWORD })
        await createRefreshToken(userId)
        await setSubscription(userId, { ...BILLING_STATES.cancelled, providerCustomerId: 'cus_r', providerSubscriptionId: 'sub_r' })
        await seedLedgerFor('cus_r', 'sub_r')
        vi.spyOn(AdminAuditLog, 'updateMany').mockRejectedValueOnce(new Error('audit store unavailable'))

        const failed = await deleteAccount(token)

        expect(failed.status).toBe(500)
        expect(await User.findById(userId)).not.toBeNull()
        expect(await Subscription.countDocuments({ userId })).toBe(1)
        expect(await RefreshToken.countDocuments({ userId })).toBeGreaterThan(0)

        const retried = await deleteAccount(token)

        expect(retried.status).toBe(200)
        expect(await User.findById(userId)).toBeNull()
        expect(await RefreshToken.countDocuments({ userId })).toBe(0)
        expect(await BillingEvent.countDocuments({ 'payload.providerSubscriptionId': 'sub_r' })).toBe(0)
    })
})
