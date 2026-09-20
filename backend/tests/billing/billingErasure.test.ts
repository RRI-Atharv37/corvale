import { describe, it, expect } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { Subscription, SyncDevice, UsageCounter } from '@modules/billing'
import { authHeader, registerUser } from '@tests/helpers'

const PASSWORD = 'DeleteMeNow123!'

describe('account erasure covers the user-scoped billing models (M2)', () => {
    it('deletes Subscription, UsageCounter and SyncDevice rows for the erased user and no one else', async () => {
        const gone = await registerUser(app, { email: 'billing-erase@example.com', password: PASSWORD })
        const kept = await registerUser(app, { email: 'billing-keep@example.com' })

        for (const { userId } of [gone, kept]) {
            await Subscription.create({ userId, planCode: 'pro', status: 'active' })
            await UsageCounter.create({ userId, resource: 'receiptBytes', value: 10 })
            await SyncDevice.create({
                userId,
                deviceId: 'laptop',
                firstSeenAt: new Date(),
                lastSeenAt: new Date(),
            })
        }

        const res = await request(app)
            .delete('/api/v1/auth/account')
            .set(authHeader(gone.token))
            .send({ password: PASSWORD })
        expect(res.status).toBe(200)

        expect(await Subscription.countDocuments({ userId: gone.userId })).toBe(0)
        expect(await UsageCounter.countDocuments({ userId: gone.userId })).toBe(0)
        expect(await SyncDevice.countDocuments({ userId: gone.userId })).toBe(0)

        expect(await Subscription.countDocuments({ userId: kept.userId })).toBe(1)
        expect(await UsageCounter.countDocuments({ userId: kept.userId })).toBe(1)
        expect(await SyncDevice.countDocuments({ userId: kept.userId })).toBe(1)
    })
})
