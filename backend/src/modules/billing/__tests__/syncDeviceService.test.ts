import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'

import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    IMPLICIT_DEVICE_ID,
    MAX_DEVICE_NAME_LENGTH,
    MAX_REGISTERED_DEVICES,
    SyncDevice,
    canDevicePush,
    listSyncDevices,
    parseDeviceId,
    parseDeviceKind,
    parseDeviceName,
    registerSyncDevice,
    renameSyncDevice,
    revokeSyncDevice,
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

describe('parseDeviceKind', () => {
    it('passes the three client kinds through and treats an absent one as no kind', () => {
        expect(parseDeviceKind('desktop')).toBe('desktop')
        expect(parseDeviceKind('web')).toBe('web')
        expect(parseDeviceKind('pwa')).toBe('pwa')
        expect(parseDeviceKind(undefined)).toBeUndefined()
    })

    it.each(['', 'Desktop', 'Windows 11 Chrome 139', 'mobile', 42, null, {}, ['web'], { $ne: 'web' }])(
        'rejects %j with a 400, so no free-form device detail can be stored',
        (bad) => {
            expect(() => parseDeviceKind(bad)).toThrowError(
                expect.objectContaining({ statusCode: 400, message: ERROR_MESSAGES.SYNC.INVALID_DEVICE_KIND })
            )
        }
    )
})

describe('parseDeviceName', () => {
    it('trims a name and keeps it as typed', () => {
        expect(parseDeviceName('  Work laptop  ')).toBe('Work laptop')
        expect(parseDeviceName('x'.repeat(MAX_DEVICE_NAME_LENGTH))).toHaveLength(MAX_DEVICE_NAME_LENGTH)
    })

    it('null clears the name', () => {
        expect(parseDeviceName(null)).toBeNull()
    })

    it.each(['', '   ', 'x'.repeat(MAX_DEVICE_NAME_LENGTH + 1), 'a\nb', 'a\tb', 'a\x00b', 'a\x7fb', 42, undefined, {}, ['a'], { $ne: 'x' }])(
        'rejects %j with a 400',
        (bad) => {
            expect(() => parseDeviceName(bad)).toThrowError(
                expect.objectContaining({ statusCode: 400, message: ERROR_MESSAGES.SYNC.INVALID_DEVICE_NAME })
            )
        }
    )
})

describe('registerSyncDevice - kind', () => {
    it('records the kind on the first sight and keeps it current afterwards', async () => {
        const id = userId()

        await registerSyncDevice(id, 'a', T0, 'web')
        expect((await SyncDevice.findOne({ userId: id, deviceId: 'a' }).lean())?.kind).toBe('web')

        await registerSyncDevice(id, 'a', later(1), 'pwa')
        expect((await SyncDevice.findOne({ userId: id, deviceId: 'a' }).lean())?.kind).toBe('pwa')
    })

    it('a call that carries no kind leaves the stored one alone', async () => {
        const id = userId()
        await registerSyncDevice(id, 'a', T0, 'desktop')

        await registerSyncDevice(id, 'a', later(1))

        expect((await SyncDevice.findOne({ userId: id, deviceId: 'a' }).lean())?.kind).toBe('desktop')
    })

    it('never touches a name the user chose', async () => {
        const id = userId()
        await registerSyncDevice(id, 'a', T0, 'web')
        await renameSyncDevice(id, 'a', 'Kitchen tablet')

        await registerSyncDevice(id, 'a', later(1), 'pwa')

        expect((await SyncDevice.findOne({ userId: id, deviceId: 'a' }).lean())?.name).toBe('Kitchen tablet')
    })
})

describe('registerSyncDevice - the first identified client adopts the implicit device', () => {
    it('renames the legacy row instead of adding a second one, so the user keeps their place in the ranking', async () => {
        const id = userId()
        await registerSyncDevice(id, undefined, T0)

        await registerSyncDevice(id, 'desktop-1', later(60_000), 'desktop')

        const rows = await SyncDevice.find({ userId: id }).lean()
        expect(rows.map((r) => r.deviceId)).toEqual(['desktop-1'])
        expect(rows[0].firstSeenAt.getTime()).toBe(T0.getTime())
        expect(rows[0].lastSeenAt.getTime()).toBe(later(60_000).getTime())
        expect(rows[0].kind).toBe('desktop')
    })

    it('only the first identified client adopts it: a second one is a new, later-ranked device', async () => {
        const id = userId()
        await registerSyncDevice(id, undefined, T0)
        await registerSyncDevice(id, 'first', later(1))
        await registerSyncDevice(id, 'second', later(2))

        expect(await canDevicePush(id, 'first', 1)).toBe(true)
        expect(await canDevicePush(id, 'second', 1)).toBe(false)
        expect(await SyncDevice.countDocuments({ userId: id })).toBe(2)
    })

    it('an old client that keeps sending no id gets a fresh implicit row, ranked last', async () => {
        const id = userId()
        await registerSyncDevice(id, undefined, T0)
        await registerSyncDevice(id, 'new-client', later(1))

        await registerSyncDevice(id, undefined, later(2))

        expect(await canDevicePush(id, 'new-client', 1)).toBe(true)
        expect(await canDevicePush(id, undefined, 1)).toBe(false)
    })

    it('does not adopt across users', async () => {
        const a = userId()
        const b = userId()
        await registerSyncDevice(a, undefined, T0)

        await registerSyncDevice(b, 'b-device', later(1))

        expect(await SyncDevice.countDocuments({ userId: a, deviceId: IMPLICIT_DEVICE_ID })).toBe(1)
        expect(await SyncDevice.countDocuments({ userId: b })).toBe(1)
    })

    it('is safe when two identified clients race for the one legacy row', async () => {
        const id = userId()
        await registerSyncDevice(id, undefined, T0)

        await Promise.all([registerSyncDevice(id, 'racer-a', later(1)), registerSyncDevice(id, 'racer-b', later(1))])

        const ids = (await SyncDevice.find({ userId: id }).lean()).map((r) => r.deviceId).sort()
        expect(ids).toEqual(['racer-a', 'racer-b'])
    })
})

describe('listSyncDevices', () => {
    it('lists devices in rank order with their kind, name and times, and nothing internal', async () => {
        const id = userId()
        await registerSyncDevice(id, 'second', later(10), 'web')
        await registerSyncDevice(id, 'first', later(0), 'desktop')
        await renameSyncDevice(id, 'first', 'Work laptop')

        const { devices, limit } = await listSyncDevices(id, undefined, null)

        expect(limit).toBeNull()
        expect(devices.map((d) => d.deviceId)).toEqual(['first', 'second'])
        expect(devices[0]).toEqual({
            deviceId: 'first',
            kind: 'desktop',
            name: 'Work laptop',
            firstSeenAt: later(0).toISOString(),
            lastSeenAt: later(0).toISOString(),
            current: false,
            canPush: true,
        })
        expect(devices[1].name).toBeNull()
        expect(JSON.stringify(devices)).not.toMatch(/_id|__v|userId|createdAt|updatedAt/)
    })

    it("marks the caller's own device and no other", async () => {
        const id = userId()
        await registerSyncDevice(id, 'a', later(0))
        await registerSyncDevice(id, 'b', later(1))

        const { devices } = await listSyncDevices(id, 'b', null)

        expect(devices.map((d) => [d.deviceId, d.current])).toEqual([
            ['a', false],
            ['b', true],
        ])
    })

    it('says which devices can push under the limit, exactly as canDevicePush decides', async () => {
        const id = userId()
        await registerSyncDevice(id, 'a', later(0))
        await registerSyncDevice(id, 'b', later(1))
        await registerSyncDevice(id, 'c', later(2))

        const { devices, limit } = await listSyncDevices(id, undefined, 2)

        expect(limit).toBe(2)
        expect(devices.map((d) => d.canPush)).toEqual([true, true, false])
        for (const d of devices) expect(d.canPush).toBe(await canDevicePush(id, d.deviceId, 2))
    })

    it('every device can push when the plan sets no limit', async () => {
        const id = userId()
        await registerSyncDevice(id, 'a', later(0))
        await registerSyncDevice(id, 'b', later(1))

        expect((await listSyncDevices(id, undefined, null)).devices.every((d) => d.canPush)).toBe(true)
    })

    it("lists only the caller's own devices", async () => {
        const mine = userId()
        await registerSyncDevice(mine, 'mine', later(0))
        await registerSyncDevice(userId(), 'theirs', later(1))

        expect((await listSyncDevices(mine, undefined, null)).devices.map((d) => d.deviceId)).toEqual(['mine'])
    })

    it('shows the implicit device under its own id with no kind', async () => {
        const id = userId()
        await registerSyncDevice(id, undefined, later(0))

        expect((await listSyncDevices(id, undefined, null)).devices[0]).toMatchObject({
            deviceId: IMPLICIT_DEVICE_ID,
            kind: null,
            name: null,
        })
    })

    it('an empty account has an empty list', async () => {
        expect(await listSyncDevices(userId(), undefined, 1)).toEqual({ devices: [], limit: 1 })
    })
})

describe('revokeSyncDevice', () => {
    it('removes the device, and only that one', async () => {
        const id = userId()
        await registerSyncDevice(id, 'a', later(0))
        await registerSyncDevice(id, 'b', later(1))

        await revokeSyncDevice(id, 'a')

        expect((await SyncDevice.find({ userId: id }).lean()).map((r) => r.deviceId)).toEqual(['b'])
    })

    it('frees the slot: the next device in rank order may push', async () => {
        const id = userId()
        await registerSyncDevice(id, 'a', later(0))
        await registerSyncDevice(id, 'b', later(1))
        expect(await canDevicePush(id, 'b', 1)).toBe(false)

        await revokeSyncDevice(id, 'a')

        expect(await canDevicePush(id, 'b', 1)).toBe(true)
    })

    it('a revoked device that syncs again is a new device, ranked last', async () => {
        const id = userId()
        await registerSyncDevice(id, 'a', later(0))
        await registerSyncDevice(id, 'b', later(1))
        await revokeSyncDevice(id, 'a')

        await registerSyncDevice(id, 'a', later(2))

        expect(await canDevicePush(id, 'b', 1)).toBe(true)
        expect(await canDevicePush(id, 'a', 1)).toBe(false)
    })

    it('frees a registration slot under the cap too', async () => {
        const id = userId()
        await SyncDevice.insertMany(
            Array.from({ length: MAX_REGISTERED_DEVICES }, (_, i) => ({ userId: id, deviceId: `d${i}`, firstSeenAt: later(i), lastSeenAt: later(i) }))
        )

        await revokeSyncDevice(id, 'd0')
        await registerSyncDevice(id, 'newcomer', later(10_000))

        expect(await SyncDevice.countDocuments({ userId: id, deviceId: 'newcomer' })).toBe(1)
    })

    it("is a 404 for a device that is not there, and never reaches another user's device", async () => {
        const mine = userId()
        const theirs = userId()
        await registerSyncDevice(theirs, 'shared-name', later(0))

        await expect(revokeSyncDevice(mine, 'shared-name')).rejects.toMatchObject({
            statusCode: 404,
            message: ERROR_MESSAGES.SYNC.DEVICE_NOT_FOUND,
        })
        expect(await SyncDevice.countDocuments({ userId: theirs })).toBe(1)
    })

    it('rejects a malformed id with a 400 before touching the database', async () => {
        await expect(revokeSyncDevice(userId(), 'has space')).rejects.toMatchObject({ statusCode: 400 })
        await expect(revokeSyncDevice(userId(), { $ne: 'x' } as unknown as string)).rejects.toMatchObject({ statusCode: 400 })
    })
})

describe('renameSyncDevice', () => {
    it('sets, replaces and clears a name', async () => {
        const id = userId()
        await registerSyncDevice(id, 'a', later(0))

        await renameSyncDevice(id, 'a', 'Work laptop')
        expect((await SyncDevice.findOne({ userId: id, deviceId: 'a' }).lean())?.name).toBe('Work laptop')

        await renameSyncDevice(id, 'a', 'Home laptop')
        expect((await SyncDevice.findOne({ userId: id, deviceId: 'a' }).lean())?.name).toBe('Home laptop')

        await renameSyncDevice(id, 'a', null)
        expect((await SyncDevice.findOne({ userId: id, deviceId: 'a' }).lean())?.name).toBeUndefined()
    })

    it('does not change the ranking or the times', async () => {
        const id = userId()
        await registerSyncDevice(id, 'a', later(0))
        await registerSyncDevice(id, 'b', later(1))

        await renameSyncDevice(id, 'b', 'Renamed')

        const row = await SyncDevice.findOne({ userId: id, deviceId: 'b' }).lean()
        expect(row?.firstSeenAt.getTime()).toBe(later(1).getTime())
        expect(row?.lastSeenAt.getTime()).toBe(later(1).getTime())
        expect(await canDevicePush(id, 'b', 1)).toBe(false)
    })

    it("is a 404 for an unknown device and never renames another user's", async () => {
        const mine = userId()
        const theirs = userId()
        await registerSyncDevice(theirs, 'shared-name', later(0))

        await expect(renameSyncDevice(mine, 'shared-name', 'Mine now')).rejects.toMatchObject({ statusCode: 404 })
        expect((await SyncDevice.findOne({ userId: theirs, deviceId: 'shared-name' }).lean())?.name).toBeUndefined()
    })
})
