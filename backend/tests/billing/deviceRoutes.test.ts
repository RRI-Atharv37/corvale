import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { SyncDevice } from '@modules/billing'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, registerUser, type RegisteredUser } from '@tests/helpers'
import { BILLING_STATES, disableBilling, enableBilling, seedTestPlans, setSubscription } from '@tests/billingHelpers'

/**
 * M6b - sync device identity on the wire, and the routes a user frees a slot with. Revoking a device
 * only deletes its row: a device that keeps syncing re-registers, last in the ranking, so the row
 * being gone is what frees the slot and nothing here blocks a client.
 */

let user: RegisteredUser
let opCounter = 0

const devices = (method: 'get' | 'patch' | 'delete', path: string, token: string | null = user.token) => {
    const req = request(app)[method](`/api/v1/billing/devices${path}`)
    return token ? req.set(authHeader(token)) : req
}

const pull = (deviceId?: string, deviceKind?: string, token = user.token) =>
    request(app)
        .get('/api/v1/sync/pull')
        .query({ ...(deviceId ? { deviceId } : {}), ...(deviceKind ? { deviceKind } : {}) })
        .set(authHeader(token))

const push = (deviceId?: string, token = user.token) =>
    request(app)
        .post('/api/v1/sync/push')
        .set(authHeader(token))
        .send({
            ...(deviceId ? { deviceId } : {}),
            ops: [
                {
                    opId: `dev-op-${(opCounter += 1)}`,
                    entity: 'account',
                    operation: 'create',
                    payload: { name: `Acct ${opCounter}`, type: 'checking', openingBalance: 1 },
                },
            ],
        })

const stored = (deviceId: string, userId = user.userId) => SyncDevice.findOne({ userId, deviceId }).lean()

beforeEach(async () => {
    enableBilling()
    await seedTestPlans()
    user = await registerUser(app)
    await setSubscription(user.userId, { planCode: 'plus' })
})

afterEach(() => disableBilling())

describe('the deviceKind wire field', () => {
    it('is stored from a pull, a bootstrap and a push', async () => {
        await pull('from-pull', 'desktop')
        await request(app).get('/api/v1/sync/bootstrap').query({ deviceId: 'from-boot', deviceKind: 'web' }).set(authHeader(user.token))
        await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(user.token))
            .send({ deviceId: 'from-push', deviceKind: 'pwa', ops: [] })

        expect((await stored('from-pull'))?.kind).toBe('desktop')
        expect((await stored('from-boot'))?.kind).toBe('web')
        expect((await stored('from-push'))?.kind).toBe('pwa')
    })

    it('a malformed kind is a 400 on pull, bootstrap and push while billing is on', async () => {
        const bad = 'Windows 11 Chrome'

        expect((await pull('kind-bad', bad)).status).toBe(400)
        expect(
            (await request(app).get('/api/v1/sync/bootstrap').query({ deviceId: 'kind-bad', deviceKind: bad }).set(authHeader(user.token))).status
        ).toBe(400)
        const pushed = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(user.token))
            .send({ deviceId: 'kind-bad', deviceKind: bad, ops: [] })
        expect(pushed.status).toBe(400)
        expect(pushed.body.message).toBe(ERROR_MESSAGES.SYNC.INVALID_DEVICE_KIND)
        expect(await SyncDevice.countDocuments({ userId: user.userId, deviceId: 'kind-bad' })).toBe(0)
    })

    it('while billing is off a malformed kind is ignored, not an error, and the device is still recorded', async () => {
        disableBilling()

        const res = await pull('kind-off', 'not-a-kind')

        expect(res.status).toBe(200)
        expect(await stored('kind-off')).not.toBeNull()
        expect((await stored('kind-off'))?.kind).toBeUndefined()
    })
})

describe('the first identified client adopts the implicit device', () => {
    it('an existing user\'s first identified sync keeps the slot the old client held', async () => {
        await pull()
        expect(await stored('_legacy')).not.toBeNull()

        expect((await push('after-update', user.token)).status).toBe(200)

        expect(await stored('_legacy')).toBeNull()
        expect(await SyncDevice.countDocuments({ userId: user.userId })).toBe(1)
    })
})

describe('GET /billing/devices', () => {
    it('requires a signed-in user', async () => {
        expect((await devices('get', '', null)).status).toBe(401)
    })

    it('lists the caller\'s devices in rank order, with which one is this device and which may push', async () => {
        await pull('device-a', 'desktop')
        await pull('device-b', 'web')

        const res = await devices('get', '?deviceId=device-b')

        expect(res.status).toBe(200)
        expect(res.body.data.limit).toBe(1)
        expect(res.body.data.devices).toEqual([
            expect.objectContaining({ deviceId: 'device-a', kind: 'desktop', name: null, current: false, canPush: true }),
            expect.objectContaining({ deviceId: 'device-b', kind: 'web', name: null, current: true, canPush: false }),
        ])
        expect(typeof res.body.data.devices[0].firstSeenAt).toBe('string')
        expect(typeof res.body.data.devices[0].lastSeenAt).toBe('string')
    })

    it('exposes nothing internal', async () => {
        await pull('device-a', 'desktop')

        const res = await devices('get', '')

        expect(JSON.stringify(res.body)).not.toMatch(/_id|__v|userId|createdAt|updatedAt/)
    })

    it('marks no device as current when the caller sends no id', async () => {
        await pull('device-a')

        const res = await devices('get', '')

        expect(res.body.data.devices.every((d: { current: boolean }) => !d.current)).toBe(true)
    })

    it('rejects a malformed deviceId with 400', async () => {
        expect((await devices('get', '?deviceId=has%20space')).status).toBe(400)
    })

    it('never lists another user\'s devices', async () => {
        const other = await registerUser(app)
        await setSubscription(other.userId, { planCode: 'plus' })
        await pull('mine')
        await pull('theirs', undefined, other.token)

        const res = await devices('get', '')

        expect(res.body.data.devices.map((d: { deviceId: string }) => d.deviceId)).toEqual(['mine'])
    })

    it('has no limit and lets every device push on a plan without one', async () => {
        await setSubscription(user.userId, { planCode: 'pro' })
        await pull('device-a')
        await pull('device-b')

        const res = await devices('get', '')

        expect(res.body.data.limit).toBeNull()
        expect(res.body.data.devices.every((d: { canPush: boolean }) => d.canPush)).toBe(true)
    })

    it('answers while billing is off: no limit, every device may push', async () => {
        disableBilling()
        await pull('device-a')
        await pull('device-b')

        const res = await devices('get', '')

        expect(res.status).toBe(200)
        expect(res.body.data.limit).toBeNull()
        expect(res.body.data.devices).toHaveLength(2)
    })

    it.each(['trial_expired', 'cancelled'] as const)('is still readable in the %s read-only state', async (state) => {
        await pull('device-a')
        await setSubscription(user.userId, BILLING_STATES[state])

        expect((await devices('get', '')).status).toBe(200)
    })
})

describe('DELETE /billing/devices/:deviceId', () => {
    it('requires a signed-in user', async () => {
        expect((await devices('delete', '/device-a', null)).status).toBe(401)
    })

    it('frees the slot end to end: the waiting device can push, and the revoked one, if it comes back, ranks last', async () => {
        expect((await push('device-a')).status).toBe(200)
        expect((await push('device-b')).status).toBe(402)

        const res = await devices('delete', '/device-a')

        expect(res.status).toBe(200)
        expect(await stored('device-a')).toBeNull()
        expect((await push('device-b')).status).toBe(200)
        expect((await push('device-a')).status).toBe(402)
        expect((await pull('device-a')).status).toBe(200)
    })

    it('is a 404 for an unknown device', async () => {
        const res = await devices('delete', '/nope')

        expect(res.status).toBe(404)
        expect(res.body.message).toBe(ERROR_MESSAGES.SYNC.DEVICE_NOT_FOUND)
    })

    it('cannot reach another user\'s device, even with the same id', async () => {
        const other = await registerUser(app)
        await setSubscription(other.userId, { planCode: 'plus' })
        await pull('shared-name', undefined, other.token)

        const res = await devices('delete', '/shared-name')

        expect(res.status).toBe(404)
        expect(await stored('shared-name', other.userId)).not.toBeNull()
    })

    it('rejects a malformed id with 400', async () => {
        expect((await devices('delete', '/has%20space')).status).toBe(400)
    })

    it('can revoke the implicit device', async () => {
        await pull()

        expect((await devices('delete', '/_legacy')).status).toBe(200)
        expect(await stored('_legacy')).toBeNull()
    })

    it.each(['trial_expired', 'cancelled', 'past_due_grace_elapsed'] as const)(
        'still works in the %s state: freeing a slot must never be locked behind a subscription',
        async (state) => {
            await pull('device-a')
            await setSubscription(user.userId, BILLING_STATES[state])

            const res = await devices('delete', '/device-a')

            expect(res.status).toBe(200)
            expect(await stored('device-a')).toBeNull()
        }
    )

    it('touches no application data: only the device row goes', async () => {
        await push('device-a')
        const { Account } = await import('@modules/accounts')
        const before = await Account.countDocuments({ userId: user.userId })

        await devices('delete', '/device-a')

        expect(await Account.countDocuments({ userId: user.userId })).toBe(before)
    })
})

describe('PATCH /billing/devices/:deviceId', () => {
    it('requires a signed-in user', async () => {
        expect((await devices('patch', '/device-a', null).send({ name: 'x' })).status).toBe(401)
    })

    it('names a device, and null clears the name', async () => {
        await pull('device-a')

        const named = await devices('patch', '/device-a').send({ name: '  Work laptop ' })
        expect(named.status).toBe(200)
        expect((await stored('device-a'))?.name).toBe('Work laptop')
        expect((await devices('get', '')).body.data.devices[0].name).toBe('Work laptop')

        const cleared = await devices('patch', '/device-a').send({ name: null })
        expect(cleared.status).toBe(200)
        expect((await stored('device-a'))?.name).toBeUndefined()
    })

    it.each([[''], ['   '], ['x'.repeat(41)], ['a\nb'], [42], [{ $ne: 'x' }], [['a']], [undefined]])(
        'rejects the name %j with 400 and stores nothing',
        async (name) => {
            await pull('device-a')

            const res = await devices('patch', '/device-a').send({ name })

            expect(res.status).toBe(400)
            expect(res.body.message).toBe(ERROR_MESSAGES.SYNC.INVALID_DEVICE_NAME)
            expect((await stored('device-a'))?.name).toBeUndefined()
        }
    )

    it('is a 404 for an unknown device and never renames another user\'s', async () => {
        const other = await registerUser(app)
        await setSubscription(other.userId, { planCode: 'plus' })
        await pull('shared-name', undefined, other.token)

        const res = await devices('patch', '/shared-name').send({ name: 'Mine now' })

        expect(res.status).toBe(404)
        expect((await stored('shared-name', other.userId))?.name).toBeUndefined()
    })

    it('changes nothing about the ranking', async () => {
        await push('device-a')
        await push('device-b')

        await devices('patch', '/device-b').send({ name: 'Renamed' })

        expect((await push('device-b')).status).toBe(402)
        expect((await push('device-a')).status).toBe(200)
    })

    it('still works while read-only: naming a device writes nothing the plan protects', async () => {
        await pull('device-a')
        await setSubscription(user.userId, BILLING_STATES.trial_expired)

        expect((await devices('patch', '/device-a').send({ name: 'Old phone' })).status).toBe(200)
    })
})
