import { describe, it, expect } from 'vitest'
import { Types } from 'mongoose'

import app from '@http/app'
import { BillingEvent, Plan, Subscription, SyncDevice, UsageCounter } from '@modules/billing'
import { runWithRlsContext } from '@core/access/rowLevelSecurity'
import { registerUser } from '@tests/helpers'
import { seedTestPlans } from '@tests/billingHelpers'

const UNSCOPED = /missing user or workspace scope/i
const DUPLICATE = /duplicate key|E11000/i

const eventDoc = (providerEventId: string) => ({
    providerEventId,
    type: 'subscription.updated',
    occurredAt: new Date(),
    payload: { hello: 'world' },
})

const deviceDoc = (userId: Types.ObjectId, deviceId: string) => ({
    userId,
    deviceId,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
})

describe('billing models - tenancy (RLS)', () => {
    it.each([
        ['Subscription', () => Subscription.find({ status: 'active' })],
        ['UsageCounter', () => UsageCounter.find({ resource: 'receiptBytes' })],
        ['SyncDevice', () => SyncDevice.find({ deviceId: 'd1' })],
    ])('%s rejects an unscoped query inside a request context', async (_name, run) => {
        const user = await registerUser(app)

        await runWithRlsContext({ userId: user.userId }, async () => {
            await expect(run()).rejects.toThrow(UNSCOPED)
        })
    })

    it.each([
        ['Subscription', (id: string) => Subscription.find({ userId: new Types.ObjectId(id) })],
        ['UsageCounter', (id: string) => UsageCounter.find({ userId: new Types.ObjectId(id) })],
        ['SyncDevice', (id: string) => SyncDevice.find({ userId: new Types.ObjectId(id) })],
    ])('%s accepts a userId-scoped query', async (_name, run) => {
        const user = await registerUser(app)

        await runWithRlsContext({ userId: user.userId }, async () => {
            await expect(run(user.userId)).resolves.toBeDefined()
        })
    })

    it('Plan is a system collection: readable inside any request context without a scope', async () => {
        await seedTestPlans()
        const user = await registerUser(app)

        await runWithRlsContext({ userId: user.userId }, async () => {
            const plans = await Plan.find({})
            expect(plans).toHaveLength(2)
        })
    })
})

describe('billing models - constraints', () => {
    it('a user has at most one Subscription', async () => {
        const base = { userId: new Types.ObjectId(), planCode: 'pro', status: 'active' }

        await Subscription.create(base)

        await expect(Subscription.create(base)).rejects.toThrow(DUPLICATE)
    })

    it('rejects a status outside the state machine', async () => {
        await expect(
            Subscription.create({ userId: new Types.ObjectId(), planCode: 'pro', status: 'paused' })
        ).rejects.toThrow()
    })

    it('grandfatherKind accepts null | free_forever | locked_rate | extended_trial and nothing else', async () => {
        for (const kind of [null, 'free_forever', 'locked_rate', 'extended_trial']) {
            await expect(
                Subscription.create({
                    userId: new Types.ObjectId(),
                    planCode: 'pro',
                    status: 'active',
                    grandfatherKind: kind,
                })
            ).resolves.toBeDefined()
        }

        await expect(
            Subscription.create({
                userId: new Types.ObjectId(),
                planCode: 'pro',
                status: 'active',
                grandfatherKind: 'lifetime_vip',
            })
        ).rejects.toThrow()
    })

    it('Plan codes are unique', async () => {
        const plan = { code: 'plus', name: 'Plus', features: {}, limits: {} }

        await Plan.create(plan)

        await expect(Plan.create(plan)).rejects.toThrow(DUPLICATE)
    })

    it('a device is unique per user, but the same deviceId may exist under two users', async () => {
        const a = new Types.ObjectId()
        const b = new Types.ObjectId()

        await SyncDevice.create(deviceDoc(a, 'laptop'))
        await SyncDevice.create(deviceDoc(b, 'laptop'))

        await expect(SyncDevice.create(deviceDoc(a, 'laptop'))).rejects.toThrow(DUPLICATE)
    })
})

describe('BillingEvent - the idempotency ledger', () => {
    it('providerEventId is unique', async () => {
        await BillingEvent.create(eventDoc('evt_1'))

        await expect(BillingEvent.create(eventDoc('evt_1'))).rejects.toThrow(DUPLICATE)
    })

    it('the recorded event is immutable: type, payload and providerEventId cannot be rewritten', async () => {
        await BillingEvent.create(eventDoc('evt_2'))

        await BillingEvent.updateOne(
            { providerEventId: 'evt_2' },
            { $set: { type: 'subscription.deleted', payload: { forged: true }, providerEventId: 'evt_other' } }
        ).catch(() => undefined)

        const stored = await BillingEvent.findOne({ providerEventId: 'evt_2' }).lean()
        expect(stored?.type).toBe('subscription.updated')
        expect(stored?.payload).toEqual({ hello: 'world' })
        expect(await BillingEvent.countDocuments({ providerEventId: 'evt_other' })).toBe(0)
    })

    it('processing bookkeeping (processedAt, error) can still be written', async () => {
        await BillingEvent.create(eventDoc('evt_3'))
        const processedAt = new Date()

        await BillingEvent.updateOne({ providerEventId: 'evt_3' }, { $set: { processedAt, error: null } })

        const stored = await BillingEvent.findOne({ providerEventId: 'evt_3' }).lean()
        expect(stored?.processedAt).toEqual(processedAt)
    })

    it('is append-only: deletes are refused', async () => {
        await BillingEvent.create(eventDoc('evt_4'))

        await expect(BillingEvent.deleteOne({ providerEventId: 'evt_4' })).rejects.toThrow()
        await expect(BillingEvent.deleteMany({})).rejects.toThrow()
        expect(await BillingEvent.countDocuments({})).toBe(1)
    })
})
