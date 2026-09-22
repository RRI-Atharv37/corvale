import { Types } from 'mongoose'
import request from 'supertest'
import type { Application } from 'express'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import defaultApp from '@http/app'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { registerUser, type RegisteredUser } from '@tests/helpers'
import { BILLING_STATES, daysFromNow, disableBilling, enableBilling, randomId, resetBillingProvider, seedTestPlans, setSubscription } from '@tests/billingHelpers'
import { ADMIN_BASE, bearer, buildAdminApp, disableAdmin, loginAsAdmin, seedAdmin, type SeededAdmin } from '@tests/adminHelpers'
import { AdminAuditLog, AdminSession, GrandfatherBatch } from '@modules/admin'
import { Subscription } from '@modules/billing'
import { User } from '@modules/users'

/**
 * M7.4 - grandfather: a single-subscriber set/revoke (an owner-only overlay, same shape as M7.3's grants), and a
 * bulk cohort with dry-run -> typed-confirm apply -> revert by batch id. Per the plan's step-up table, only the
 * *bulk* apply and revert are money/permanent-adjacent enough to need a fresh authenticator code; the single-user
 * action and the dry-run preview do not, matching M7.3's "reversible overlay" treatment.
 */

const REASON = 'Pre-paywall cohort, decided at the planning review'

let app: Application
let owner: SeededAdmin
let ownerToken: string
let user: RegisteredUser

beforeAll(() => {
    app = buildAdminApp()
})

afterAll(() => {
    disableAdmin()
})

beforeEach(async () => {
    enableBilling()
    await seedTestPlans()
    owner = await seedAdmin({ role: 'owner' })
    ;({ token: ownerToken } = await loginAsAdmin(app, owner))
    user = await registerUser(defaultApp)
    await setSubscription(user.userId, { ...BILLING_STATES.trial_expired, providerCustomerId: null, providerSubscriptionId: null })
})

afterEach(() => {
    disableBilling()
    resetBillingProvider()
})

const postUser = (path: string, body: Record<string, unknown> = {}, token: string = ownerToken) =>
    request(app).post(`${ADMIN_BASE}/subscribers/${user.userId}${path}`).set(bearer(token)).send(body)

const postCohort = (path: string, body: Record<string, unknown> = {}, token: string = ownerToken) =>
    request(app).post(`${ADMIN_BASE}/grandfather/cohort${path}`).set(bearer(token)).send(body)

const stored = (userId: string = user.userId) => Subscription.findOne({ userId }).lean()

const setRegisteredAt = (userId: string, date: Date) => User.collection.updateOne({ _id: new Types.ObjectId(userId) }, { $set: { createdAt: date } })

const seedCohortMember = async (options: { daysAgo: number; providerLinked?: boolean; grandfatherKind?: 'free_forever' | 'locked_rate' | 'extended_trial' | null }) => {
    const member = await registerUser(defaultApp)
    await setRegisteredAt(member.userId, daysFromNow(-options.daysAgo))
    await setSubscription(member.userId, {
        ...BILLING_STATES.trial_expired,
        providerCustomerId: options.providerLinked ? `cus_${member.userId}` : null,
        providerSubscriptionId: options.providerLinked ? `sub_${member.userId}` : null,
        grandfatherKind: options.grandfatherKind ?? null,
    })
    return member
}

const CUTOFF = daysFromNow(-30)

describe('access', () => {
    it('only an owner can reach any grandfather endpoint; unauthenticated callers get 401', async () => {
        const support = await seedAdmin({ role: 'support' })
        const { token: supportToken } = await loginAsAdmin(app, support)
        const finance = await seedAdmin({ role: 'finance' })
        const { token: financeToken } = await loginAsAdmin(app, finance)

        for (const token of [supportToken, financeToken]) {
            expect((await postUser('/grandfather', { kind: 'free_forever', reason: REASON }, token)).status).toBe(403)
            expect((await postUser('/grandfather/revoke', { reason: REASON }, token)).status).toBe(403)
            expect((await postCohort('/dry-run', { kind: 'free_forever', registeredBefore: CUTOFF.toISOString() }, token)).status).toBe(403)
            expect((await postCohort('/apply', { kind: 'free_forever', registeredBefore: CUTOFF.toISOString(), confirmCount: 0, reason: REASON }, token)).status).toBe(403)
            expect((await postCohort(`/${randomId()}/revert`, { reason: REASON }, token)).status).toBe(403)
        }

        expect((await request(app).post(`${ADMIN_BASE}/subscribers/${user.userId}/grandfather`).send({})).status).toBe(401)
    })
})

describe('POST /subscribers/:userId/grandfather', () => {
    it('does not need a step-up: like a comp, this is a reversible overlay', async () => {
        await AdminSession.updateMany({ adminId: owner.id }, { $set: { stepUpAt: null } })

        expect((await postUser('/grandfather', { kind: 'free_forever', reason: REASON })).status).toBe(200)
    })

    it('sets the kind and audits before/after', async () => {
        const res = await postUser('/grandfather', { kind: 'free_forever', reason: REASON })

        expect(res.status).toBe(200)
        expect(res.body.data).toEqual({ grandfatherKind: 'free_forever' })
        expect((await stored())?.grandfatherKind).toBe('free_forever')

        const row = await AdminAuditLog.findOne({ action: 'grandfather.set' }).lean()
        expect(row?.adminId?.toString()).toBe(owner.id)
        expect(row?.subjectUserId?.toString()).toBe(user.userId)
        expect(row?.before).toEqual({ grandfatherKind: null })
        expect(row?.after).toEqual({ grandfatherKind: 'free_forever' })
        expect(row?.reason).toBe(REASON)
        expect(row?.expireAt).toBeNull()
    })

    it.each(['locked_rate', 'extended_trial'])('accepts %s as well', async (kind) => {
        expect((await postUser('/grandfather', { kind, reason: REASON })).status).toBe(200)
        expect((await stored())?.grandfatherKind).toBe(kind)
    })

    it('rejects an unknown kind, a missing reason, and a malformed or missing subscriber', async () => {
        expect((await postUser('/grandfather', { kind: 'lifetime_deal', reason: REASON })).status).toBe(400)
        expect((await postUser('/grandfather', { kind: 'free_forever' })).status).toBe(400)
        expect((await postUser('/grandfather', { kind: 'free_forever', reason: 'short' })).status).toBe(400)

        expect((await request(app).post(`${ADMIN_BASE}/subscribers/${randomId()}/grandfather`).set(bearer(ownerToken)).send({ kind: 'free_forever', reason: REASON })).status).toBe(404)
        expect((await request(app).post(`${ADMIN_BASE}/subscribers/not-an-id/grandfather`).set(bearer(ownerToken)).send({ kind: 'free_forever', reason: REASON })).status).toBe(400)
        expect((await stored())?.grandfatherKind ?? null).toBeNull()
    })

    it('replaces an earlier kind and audits what it replaced', async () => {
        await postUser('/grandfather', { kind: 'extended_trial', reason: REASON })
        await postUser('/grandfather', { kind: 'free_forever', reason: REASON })

        expect((await stored())?.grandfatherKind).toBe('free_forever')
        const rows = await AdminAuditLog.find({ action: 'grandfather.set' }).sort({ at: 1 }).lean()
        expect(rows).toHaveLength(2)
        expect(rows[1].before).toEqual({ grandfatherKind: 'extended_trial' })
    })
})

describe('POST /subscribers/:userId/grandfather/revoke', () => {
    it('clears the kind and audits it', async () => {
        await postUser('/grandfather', { kind: 'free_forever', reason: REASON })

        const res = await postUser('/grandfather/revoke', { reason: REASON })

        expect(res.status).toBe(200)
        expect((await stored())?.grandfatherKind ?? null).toBeNull()
        const row = await AdminAuditLog.findOne({ action: 'grandfather.revoked' }).lean()
        expect(row?.before).toEqual({ grandfatherKind: 'free_forever' })
        expect(row?.after).toEqual({ grandfatherKind: null })
    })

    it('404s when the subscriber is not grandfathered, and needs a reason', async () => {
        const res = await postUser('/grandfather/revoke', { reason: REASON })
        expect(res.status).toBe(404)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.NO_GRANDFATHER)

        await postUser('/grandfather', { kind: 'free_forever', reason: REASON })
        expect((await postUser('/grandfather/revoke', {})).status).toBe(400)
        expect((await stored())?.grandfatherKind).toBe('free_forever')
    })
})

describe('POST /grandfather/cohort/dry-run', () => {
    it('counts and samples the cohort - before a cutoff, no provider link, not already grandfathered - without writing anything', async () => {
        const eligible = await seedCohortMember({ daysAgo: 60 })
        await seedCohortMember({ daysAgo: 10 })
        await seedCohortMember({ daysAgo: 60, providerLinked: true })
        await seedCohortMember({ daysAgo: 60, grandfatherKind: 'locked_rate' })

        const res = await postCohort('/dry-run', { kind: 'free_forever', registeredBefore: CUTOFF.toISOString() })

        expect(res.status).toBe(200)
        expect(res.body.data.count).toBe(1)
        expect(res.body.data.sample).toHaveLength(1)
        expect(res.body.data.sample[0]).toMatch(/^.\*\*\*@/)
        expect(res.body.data.sample[0]).not.toContain(eligible.email)
        expect((await stored(eligible.userId))?.grandfatherKind ?? null).toBeNull()
        expect(await AdminAuditLog.countDocuments()).toBe(0)
    })

    it('does not need a step-up', async () => {
        await AdminSession.updateMany({ adminId: owner.id }, { $set: { stepUpAt: null } })

        expect((await postCohort('/dry-run', { kind: 'free_forever', registeredBefore: CUTOFF.toISOString() })).status).toBe(200)
    })

    it('rejects an unknown kind or a bad/future cutoff', async () => {
        expect((await postCohort('/dry-run', { kind: 'lifetime_deal', registeredBefore: CUTOFF.toISOString() })).status).toBe(400)
        expect((await postCohort('/dry-run', { kind: 'free_forever', registeredBefore: 'not-a-date' })).status).toBe(400)
        expect((await postCohort('/dry-run', { kind: 'free_forever', registeredBefore: daysFromNow(1).toISOString() })).status).toBe(400)
    })
})

describe('POST /grandfather/cohort/apply', () => {
    it('needs a fresh step-up', async () => {
        await AdminSession.updateMany({ adminId: owner.id }, { $set: { stepUpAt: null } })

        const res = await postCohort('/apply', { kind: 'free_forever', registeredBefore: CUTOFF.toISOString(), confirmCount: 0, reason: REASON })

        expect(res.status).toBe(403)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.STEP_UP_REQUIRED)
    })

    it('needs the typed count to match what the cohort resolves to right now', async () => {
        await seedCohortMember({ daysAgo: 60 })

        const missing = await postCohort('/apply', { kind: 'free_forever', registeredBefore: CUTOFF.toISOString(), reason: REASON })
        expect(missing.status).toBe(400)
        expect(missing.body.message).toBe(ERROR_MESSAGES.ADMIN.COHORT_CONFIRM_REQUIRED)

        const mismatch = await postCohort('/apply', { kind: 'free_forever', registeredBefore: CUTOFF.toISOString(), confirmCount: 0, reason: REASON })
        expect(mismatch.status).toBe(409)
        expect(mismatch.body.message).toBe(ERROR_MESSAGES.ADMIN.COHORT_COUNT_MISMATCH)
    })

    it('refuses an empty cohort', async () => {
        const res = await postCohort('/apply', { kind: 'free_forever', registeredBefore: CUTOFF.toISOString(), confirmCount: 0, reason: REASON })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.COHORT_EMPTY)
    })

    it('sets the kind on exactly the eligible cohort, creates a batch, and audits it with no expiry', async () => {
        const eligible = await seedCohortMember({ daysAgo: 60 })
        const tooRecent = await seedCohortMember({ daysAgo: 10 })
        const linked = await seedCohortMember({ daysAgo: 60, providerLinked: true })
        const already = await seedCohortMember({ daysAgo: 60, grandfatherKind: 'locked_rate' })

        const res = await postCohort('/apply', { kind: 'free_forever', registeredBefore: CUTOFF.toISOString(), confirmCount: 1, reason: REASON })

        expect(res.status).toBe(200)
        expect(res.body.data.appliedCount).toBe(1)
        const batchId = res.body.data.batchId
        expect(batchId).toBeTruthy()

        expect((await stored(eligible.userId))?.grandfatherKind).toBe('free_forever')
        expect((await stored(tooRecent.userId))?.grandfatherKind ?? null).toBeNull()
        expect((await stored(linked.userId))?.grandfatherKind ?? null).toBeNull()
        expect((await stored(already.userId))?.grandfatherKind).toBe('locked_rate')

        const batch = await GrandfatherBatch.findById(batchId).lean()
        expect(batch?.status).toBe('applied')
        expect(batch?.kind).toBe('free_forever')
        expect(batch?.subscriptionIds).toHaveLength(1)
        expect(batch?.createdBy.toString()).toBe(owner.id)

        const row = await AdminAuditLog.findOne({ action: 'grandfather.bulk_applied' }).lean()
        expect(row?.after).toEqual({ grandfatherKind: 'free_forever', batchId, affectedCount: 1 })
        expect(row?.subjectUserId).toBeNull()
        expect(row?.expireAt).toBeNull()
        const raw = JSON.stringify(row)
        expect(raw).not.toContain(eligible.email)
    })

    it('a second apply over the same criteria only picks up rows the first one left ungrandfathered', async () => {
        await seedCohortMember({ daysAgo: 60 })
        await postCohort('/apply', { kind: 'free_forever', registeredBefore: CUTOFF.toISOString(), confirmCount: 1, reason: REASON })

        const res = await postCohort('/apply', { kind: 'free_forever', registeredBefore: CUTOFF.toISOString(), confirmCount: 1, reason: REASON })
        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.COHORT_EMPTY)
    })
})

describe('POST /grandfather/cohort/:batchId/revert', () => {
    const applyOne = async () => {
        const member = await seedCohortMember({ daysAgo: 60 })
        const res = await postCohort('/apply', { kind: 'free_forever', registeredBefore: CUTOFF.toISOString(), confirmCount: 1, reason: REASON })
        return { member, batchId: res.body.data.batchId as string }
    }

    it('needs a fresh step-up', async () => {
        const { batchId } = await applyOne()
        await AdminSession.updateMany({ adminId: owner.id }, { $set: { stepUpAt: null } })

        const res = await postCohort(`/${batchId}/revert`, { reason: REASON })

        expect(res.status).toBe(403)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.STEP_UP_REQUIRED)
    })

    it('reverts exactly the batch, marks it reverted, and audits it', async () => {
        const { member, batchId } = await applyOne()

        const res = await postCohort(`/${batchId}/revert`, { reason: REASON })

        expect(res.status).toBe(200)
        expect(res.body.data.revertedCount).toBe(1)
        expect((await stored(member.userId))?.grandfatherKind ?? null).toBeNull()

        const batch = await GrandfatherBatch.findById(batchId).lean()
        expect(batch?.status).toBe('reverted')
        expect(batch?.revertedBy?.toString()).toBe(owner.id)
        expect(batch?.revertedAt).toBeTruthy()

        const row = await AdminAuditLog.findOne({ action: 'grandfather.bulk_reverted' }).lean()
        expect(row?.before).toEqual({ grandfatherKind: 'free_forever' })
        expect(row?.after).toEqual({ grandfatherKind: null, batchId, affectedCount: 1 })
    })

    it('leaves a row alone if an admin already changed it by hand since the batch applied', async () => {
        const { member, batchId } = await applyOne()
        await request(app)
            .post(`${ADMIN_BASE}/subscribers/${member.userId}/grandfather`)
            .set(bearer(ownerToken))
            .send({ kind: 'locked_rate', reason: REASON })

        const res = await postCohort(`/${batchId}/revert`, { reason: REASON })

        expect(res.status).toBe(200)
        expect(res.body.data.revertedCount).toBe(0)
        expect((await stored(member.userId))?.grandfatherKind).toBe('locked_rate')
    })

    it('404s for an unknown batch, 400s for one already reverted, 400s for a malformed id', async () => {
        expect((await postCohort(`/${randomId()}/revert`, { reason: REASON })).status).toBe(404)
        expect((await postCohort('/not-an-id/revert', { reason: REASON })).status).toBe(400)

        const { batchId } = await applyOne()
        await postCohort(`/${batchId}/revert`, { reason: REASON })
        const res = await postCohort(`/${batchId}/revert`, { reason: REASON })
        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.BATCH_NOT_APPLIED)
    })
})

describe('GET /grandfather/cohort/batches', () => {
    it('lists batches newest first, without the sampled emails', async () => {
        await seedCohortMember({ daysAgo: 60 })
        const res = await postCohort('/apply', { kind: 'free_forever', registeredBefore: CUTOFF.toISOString(), confirmCount: 1, reason: REASON })

        const list = await request(app).get(`${ADMIN_BASE}/grandfather/cohort/batches`).set(bearer(ownerToken))

        expect(list.status).toBe(200)
        expect(list.body.data.batches).toHaveLength(1)
        expect(list.body.data.batches[0]).toMatchObject({ id: res.body.data.batchId, kind: 'free_forever', status: 'applied', count: 1 })
    })
})
