import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import app from '@http/app'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { User } from '@modules/users'
import {
    BillingEvent,
    Subscription,
    createFakeBillingProvider,
    resetBillingProvider,
    setBillingProvider,
} from '@modules/billing'
import { authHeader, registerUser } from '@tests/helpers'
import {
    BILLING_STATES,
    disableBilling,
    enableBilling,
    randomId,
    seedWorkspace,
    setSubscription,
} from '@tests/billingHelpers'

/**
 * M7.0 - erasing an account used to leave a live provider subscription billing a person who no
 * longer exists, and left provider ids in the append-only ledger. Erasure now stops the
 * provider billing first (refusing to erase if it cannot), then redacts the ledger.
 */

const PASSWORD = 'DeleteMeNow123!'

const deleteAccount = (token: string, password: string = PASSWORD) =>
    request(app).delete('/api/v1/auth/account').set(authHeader(token)).send({ password })

const seedLedger = (customer: string, subscription: string) =>
    BillingEvent.create({
        providerEventId: `evt_${subscription}_${Math.random()}`,
        type: 'payment.succeeded',
        occurredAt: new Date(),
        payload: { providerCustomerId: customer, providerSubscriptionId: subscription, total: 600, currency: 'USD' },
        processedAt: new Date(),
    })

const installProvider = (options: { failCancel?: boolean } = {}) => {
    const { provider, calls } = createFakeBillingProvider()
    setBillingProvider(
        options.failCancel
            ? {
                  ...provider,
                  cancelSubscription: async () => {
                      throw new CustomError(ERROR_MESSAGES.BILLING.PROVIDER_REQUEST_FAILED, 502)
                  },
              }
            : provider
    )
    return calls
}

beforeEach(() => enableBilling())
afterEach(() => {
    disableBilling()
    resetBillingProvider()
})

describe('account erasure with a provider subscription', () => {
    it.each(['active', 'past_due_in_grace'] as const)('cancels a %s subscription at the provider before erasing', async (state) => {
        const calls = installProvider()
        const { userId, token } = await registerUser(app, { email: `erase-${state}@example.com`, password: PASSWORD })
        await setSubscription(userId, { ...BILLING_STATES[state], providerCustomerId: 'cus_e', providerSubscriptionId: 'sub_e' })

        const res = await deleteAccount(token)

        expect(res.status).toBe(200)
        expect(calls.cancelSubscription).toEqual([{ providerSubscriptionId: 'sub_e', immediate: true }])
        expect(await User.findById(userId)).toBeNull()
        expect(await Subscription.countDocuments({ userId })).toBe(0)
    })

    it('cancels a trialing subscription that has a provider link', async () => {
        const calls = installProvider()
        const { userId, token } = await registerUser(app, { email: 'erase-trial-linked@example.com', password: PASSWORD })
        await setSubscription(userId, { ...BILLING_STATES.trialing, providerCustomerId: 'cus_t', providerSubscriptionId: 'sub_t' })

        expect((await deleteAccount(token)).status).toBe(200)

        expect(calls.cancelSubscription).toHaveLength(1)
    })

    it('does not call the provider for a trial with no provider link', async () => {
        const calls = installProvider()
        const { userId, token } = await registerUser(app, { email: 'erase-trial@example.com', password: PASSWORD })
        await setSubscription(userId, { ...BILLING_STATES.trialing, providerCustomerId: null, providerSubscriptionId: null })

        expect((await deleteAccount(token)).status).toBe(200)

        expect(calls.cancelSubscription).toHaveLength(0)
        expect(await User.findById(userId)).toBeNull()
    })

    it.each(['cancelled', 'trial_expired'] as const)('does not call the provider for a %s subscription', async (state) => {
        const calls = installProvider()
        const { userId, token } = await registerUser(app, { email: `erase-${state}@example.com`, password: PASSWORD })
        await setSubscription(userId, { ...BILLING_STATES[state], providerCustomerId: 'cus_c', providerSubscriptionId: 'sub_c' })

        expect((await deleteAccount(token)).status).toBe(200)

        expect(calls.cancelSubscription).toHaveLength(0)
    })

    it('refuses to erase when the provider cannot cancel, and changes nothing', async () => {
        installProvider({ failCancel: true })
        const { userId, token } = await registerUser(app, { email: 'erase-fail@example.com', password: PASSWORD })
        await setSubscription(userId, { ...BILLING_STATES.active, providerCustomerId: 'cus_f', providerSubscriptionId: 'sub_f' })
        await seedLedger('cus_f', 'sub_f')

        const res = await deleteAccount(token)

        expect(res.status).toBe(502)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.ERASURE_CANCEL_FAILED)
        expect(await User.findById(userId)).not.toBeNull()
        expect(await Subscription.countDocuments({ userId })).toBe(1)
        const row = await BillingEvent.findOne({ 'payload.providerSubscriptionId': 'sub_f' }).lean()
        expect(row?.redactedAt ?? null).toBeNull()
    })

    it('never calls the provider when the password is wrong', async () => {
        const calls = installProvider()
        const { userId, token } = await registerUser(app, { email: 'erase-wrongpw@example.com', password: PASSWORD })
        await setSubscription(userId, BILLING_STATES.active)

        const res = await deleteAccount(token, 'not-the-password')

        expect(res.status).toBe(400)
        expect(calls.cancelSubscription).toHaveLength(0)
        expect(await User.findById(userId)).not.toBeNull()
    })

    it('never calls the provider when erasure is blocked by a workspace with other members', async () => {
        const calls = installProvider()
        const { userId, token } = await registerUser(app, { email: 'erase-blocked@example.com', password: PASSWORD })
        await setSubscription(userId, BILLING_STATES.active)
        await seedWorkspace(userId, [{ userId: randomId(), role: 'editor' }])

        const res = await deleteAccount(token)

        expect(res.status).toBe(409)
        expect(calls.cancelSubscription).toHaveLength(0)
    })

    it('does not call the provider while billing is off, but still erases', async () => {
        disableBilling()
        const calls = installProvider()
        const { userId, token } = await registerUser(app, { email: 'erase-off@example.com', password: PASSWORD })
        await setSubscription(userId, BILLING_STATES.active)

        expect((await deleteAccount(token)).status).toBe(200)

        expect(calls.cancelSubscription).toHaveLength(0)
        expect(await User.findById(userId)).toBeNull()
    })
})

describe('account erasure and the ledger', () => {
    it("redacts the erased user's provider ids from the ledger and leaves other users' rows alone", async () => {
        installProvider()
        const { userId, token } = await registerUser(app, { email: 'erase-ledger@example.com', password: PASSWORD })
        await setSubscription(userId, { ...BILLING_STATES.cancelled, providerCustomerId: 'cus_mine', providerSubscriptionId: 'sub_mine' })
        await seedLedger('cus_mine', 'sub_mine')
        await seedLedger('cus_other', 'sub_other')

        expect((await deleteAccount(token)).status).toBe(200)

        const mine = await BillingEvent.findOne({ type: 'payment.succeeded', redactedAt: { $ne: null } }).lean()
        expect(mine?.payload).toEqual({ total: 600, currency: 'USD' })
        const other = await BillingEvent.findOne({ 'payload.providerSubscriptionId': 'sub_other' }).lean()
        expect(other?.redactedAt ?? null).toBeNull()
        expect(await BillingEvent.countDocuments({ 'payload.providerSubscriptionId': 'sub_mine' })).toBe(0)
        expect(await BillingEvent.countDocuments({ 'payload.providerCustomerId': 'cus_mine' })).toBe(0)
    })

    it('redacts the ledger even when billing is off', async () => {
        disableBilling()
        const { userId, token } = await registerUser(app, { email: 'erase-ledger-off@example.com', password: PASSWORD })
        await setSubscription(userId, { ...BILLING_STATES.cancelled, providerCustomerId: 'cus_off', providerSubscriptionId: 'sub_off' })
        await seedLedger('cus_off', 'sub_off')

        expect((await deleteAccount(token)).status).toBe(200)

        expect(await BillingEvent.countDocuments({ 'payload.providerSubscriptionId': 'sub_off' })).toBe(0)
    })
})
