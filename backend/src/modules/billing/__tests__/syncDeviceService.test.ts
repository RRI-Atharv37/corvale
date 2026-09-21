import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'

import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    IMPLICIT_DEVICE_ID,
    MAX_REGISTERED_DEVICES,
    SyncDevice,
    canDevicePush,
    parseDeviceId,
    registerSyncDevice,
} from '@modules/billing'

/**
 * M4 - sync device identity. Devices are ranked by first-seen order and only the first
 * `syncDevices` of them may push; the rest keep pulling. A client that sends no id is one implicit
 * device, so old clients keep working. Registration is idempotent and bounded.
 */

const userId = () => new Types.ObjectId().toString()
const T0 = new Date('2026-10-01T00:00:00.000Z')
const later = (ms: number) => new Date(T0.getTime() + ms)

describe('parseDeviceId', () => {
    it('passes a valid id through and treats an absent one as no id', () => {
        expect(parseDeviceId('laptop-1_A')).toBe('laptop-1_A')
        expect(parseDeviceId('x'.repeat(64))).toHaveLength(64)
        expect(parseDeviceId(undefined)).toBeUndefined()
    })

    it.each(['', ' ', 'has space', 'x'.repeat(65), 'a/b', 'é', 42, null, {}, ['a'], { $ne: 'x' }])(
        'rejects %j with a 400',
        (bad) => {
            expect(() => parseDeviceId(bad)).toThrowError(
                expect.objectContaining({ statusCode: 400, message: ERROR_MESSAGES.SYNC.INVALID_DEVICE_ID })
            )
        }
    )
})

describe('registerSyncDevice', () => {
    it('registers a device once, however often it is seen, and keeps its first-seen time', async () => {
        const id = userId()

        await registerSyncDevice(id, 'a', T0)
        await registerSyncDevice(id, 'a', later(5_000))

        const rows = await SyncDevice.find({ userId: id }).lean()
        expect(rows).toHaveLength(1)
        expect(rows[0].firstSeenAt.getTime()).toBe(T0.getTime())
        expect(rows[0].lastSeenAt.getTime()).toBe(later(5_000).getTime())
    })

    it('registers a client with no id as the implicit device', async () => {
        const id = userId()

        await registerSyncDevice(id, undefined, T0)
        await registerSyncDevice(id, undefined, later(1))

        const rows = await SyncDevice.find({ userId: id }).lean()
        expect(rows.map((r) => r.deviceId)).toEqual([IMPLICIT_DEVICE_ID])
    })

    it('is safe under a burst of the same first request', async () => {
        const id = userId()

        await Promise.all(Array.from({ length: 8 }, () => registerSyncDevice(id, 'burst', T0)))

        expect(await SyncDevice.countDocuments({ userId: id })).toBe(1)
    })

    it('keeps each user separate', async () => {
        const a = userId()
        const b = userId()

        await registerSyncDevice(a, 'same', T0)
        await registerSyncDevice(b, 'same', T0)

        expect(await SyncDevice.countDocuments({ deviceId: 'same' })).toBe(2)
    })

    it('stops registering new devices at the cap, without refusing the ones it knows', async () => {
        const id = userId()
        await SyncDevice.insertMany(
            Array.from({ length: MAX_REGISTERED_DEVICES }, (_, i) => ({ userId: id, deviceId: `d${i}`, firstSeenAt: later(i), lastSeenAt: later(i) }))
        )

        await registerSyncDevice(id, 'one-too-many', later(10_000))
        await registerSyncDevice(id, 'd0', later(10_001))

        expect(await SyncDevice.countDocuments({ userId: id })).toBe(MAX_REGISTERED_DEVICES)
        expect((await SyncDevice.findOne({ userId: id, deviceId: 'd0' }).lean())?.lastSeenAt.getTime()).toBe(later(10_001).getTime())
    })
})

describe('canDevicePush', () => {
    it('lets the earliest-registered devices push and refuses the rest', async () => {
        const id = userId()
        await registerSyncDevice(id, 'first', later(0))
        await registerSyncDevice(id, 'second', later(1))
        await registerSyncDevice(id, 'third', later(2))

        expect(await canDevicePush(id, 'first', 2)).toBe(true)
        expect(await canDevicePush(id, 'second', 2)).toBe(true)
        expect(await canDevicePush(id, 'third', 2)).toBe(false)
    })

    it('ranks by first-seen, not by who called last', async () => {
        const id = userId()
        await registerSyncDevice(id, 'first', later(0))
        await registerSyncDevice(id, 'second', later(1))
        await registerSyncDevice(id, 'first', later(500))

        expect(await canDevicePush(id, 'second', 1)).toBe(false)
        expect(await canDevicePush(id, 'first', 1)).toBe(true)
    })

    it('breaks a first-seen tie the same way every time', async () => {
        const id = userId()
        await SyncDevice.create([
            { userId: id, deviceId: 'tie-a', firstSeenAt: T0, lastSeenAt: T0 },
            { userId: id, deviceId: 'tie-b', firstSeenAt: T0, lastSeenAt: T0 },
        ])

        const allowed = [await canDevicePush(id, 'tie-a', 1), await canDevicePush(id, 'tie-b', 1)]

        expect(allowed.filter(Boolean)).toHaveLength(1)
    })

    it('a null limit lets every device push', async () => {
        const id = userId()
        await registerSyncDevice(id, 'a', later(0))
        await registerSyncDevice(id, 'b', later(1))

        expect(await canDevicePush(id, 'b', null)).toBe(true)
    })

    it('a limit of zero refuses every device', async () => {
        const id = userId()
        await registerSyncDevice(id, 'a', later(0))

        expect(await canDevicePush(id, 'a', 0)).toBe(false)
    })

    it('an unregistered device may not push while a limit applies (it must register first)', async () => {
        expect(await canDevicePush(userId(), 'ghost', 1)).toBe(false)
    })

    it('the implicit device ranks like any other', async () => {
        const id = userId()
        await registerSyncDevice(id, undefined, later(0))
        await registerSyncDevice(id, 'named', later(1))

        expect(await canDevicePush(id, undefined, 1)).toBe(true)
        expect(await canDevicePush(id, 'named', 1)).toBe(false)
    })

    it('raising the limit lets the waiting devices push without any re-registration', async () => {
        const id = userId()
        await registerSyncDevice(id, 'a', later(0))
        await registerSyncDevice(id, 'b', later(1))
        expect(await canDevicePush(id, 'b', 1)).toBe(false)

        expect(await canDevicePush(id, 'b', 2)).toBe(true)
    })
})
