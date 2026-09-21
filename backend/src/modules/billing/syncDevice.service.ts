import { isDuplicateKeyError } from '@core/db/objectId'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import SyncDevice, { DEVICE_ID_PATTERN, DEVICE_KINDS, MAX_DEVICE_NAME_LENGTH, type DeviceKind } from './syncDevice.model'

export const IMPLICIT_DEVICE_ID = '_legacy'

// A user-controlled id must not be able to grow a collection without bound.
export const MAX_REGISTERED_DEVICES = 100

export interface SyncDeviceView {
    deviceId: string
    kind: DeviceKind | null
    name: string | null
    firstSeenAt: string
    lastSeenAt: string
    current: boolean
    canPush: boolean
}

export const parseDeviceId = (raw: unknown): string | undefined => {
    if (raw === undefined) return undefined
    if (typeof raw !== 'string' || !DEVICE_ID_PATTERN.test(raw)) {
        throw new CustomError(ERROR_MESSAGES.SYNC.INVALID_DEVICE_ID, 400)
    }
    return raw
}

export const parseDeviceKind = (raw: unknown): DeviceKind | undefined => {
    if (raw === undefined) return undefined
    if (typeof raw !== 'string' || !(DEVICE_KINDS as readonly string[]).includes(raw)) {
        throw new CustomError(ERROR_MESSAGES.SYNC.INVALID_DEVICE_KIND, 400)
    }
    return raw as DeviceKind
}

const hasControlCharacter = (value: string): boolean => [...value].some((char) => {
    const code = char.codePointAt(0) ?? 0
    return code < 32 || code === 127
})

/** `null` clears the name. */
export const parseDeviceName = (raw: unknown): string | null => {
    if (raw === null) return null
    const name = typeof raw === 'string' ? raw.trim() : ''
    if (!name || name.length > MAX_DEVICE_NAME_LENGTH || hasControlCharacter(name)) {
        throw new CustomError(ERROR_MESSAGES.SYNC.INVALID_DEVICE_NAME, 400)
    }
    return name
}

const requireDeviceId = (raw: unknown): string => {
    const deviceId = parseDeviceId(raw)
    if (deviceId === undefined) throw new CustomError(ERROR_MESSAGES.SYNC.INVALID_DEVICE_ID, 400)
    return deviceId
}

export const registerSyncDevice = async (
    userId: string,
    deviceId: string | undefined,
    now: Date = new Date(),
    kind?: DeviceKind
): Promise<void> => {
    const id = deviceId ?? IMPLICIT_DEVICE_ID
    const seen = { lastSeenAt: now, ...(kind ? { kind } : {}) }

    const known = await SyncDevice.updateOne({ userId, deviceId: id }, { $set: seen })
    if (known.matchedCount > 0) return

    // Clients that shipped before ids existed all share the implicit row. The first identified client
    // takes it over, keeping its place in the ranking, so upgrading never demotes a user's device.
    if (id !== IMPLICIT_DEVICE_ID) {
        try {
            const adopted = await SyncDevice.findOneAndUpdate({ userId, deviceId: IMPLICIT_DEVICE_ID }, { $set: { deviceId: id, ...seen } })
            if (adopted) return
        } catch (error) {
            if (isDuplicateKeyError(error)) return
            throw error
        }
    }

    if ((await SyncDevice.countDocuments({ userId })) >= MAX_REGISTERED_DEVICES) return

    try {
        await SyncDevice.create({ userId, deviceId: id, ...(kind ? { kind } : {}), firstSeenAt: now, lastSeenAt: now })
    } catch (error) {
        if (!isDuplicateKeyError(error)) throw error
    }
}

/** Devices rank by first-seen order (id breaks a tie); only the first `limit` may push. */
export const canDevicePush = async (userId: string, deviceId: string | undefined, limit: number | null): Promise<boolean> => {
    if (limit === null) return true

    const device = await SyncDevice.findOne({ userId, deviceId: deviceId ?? IMPLICIT_DEVICE_ID }).lean()
    if (!device) return false

    const ahead = await SyncDevice.countDocuments({
        userId,
        $or: [{ firstSeenAt: { $lt: device.firstSeenAt } }, { firstSeenAt: device.firstSeenAt, _id: { $lt: device._id } }],
    })
    return ahead < limit
}

export const listSyncDevices = async (
    userId: string,
    currentDeviceId: string | undefined,
    limit: number | null
): Promise<{ devices: SyncDeviceView[]; limit: number | null }> => {
    const rows = await SyncDevice.find({ userId }).sort({ firstSeenAt: 1, _id: 1 }).lean()

    return {
        limit,
        devices: rows.map((row, rank) => ({
            deviceId: row.deviceId,
            kind: row.kind ?? null,
            name: row.name ?? null,
            firstSeenAt: row.firstSeenAt.toISOString(),
            lastSeenAt: row.lastSeenAt.toISOString(),
            current: row.deviceId === currentDeviceId,
            canPush: limit === null || rank < limit,
        })),
    }
}

/**
 * Deleting the row is all a revoke does. A device that keeps syncing registers again as a new one,
 * last in the ranking, so its slot is only ever freed for the devices behind it.
 */
export const revokeSyncDevice = async (userId: string, rawDeviceId: unknown): Promise<void> => {
    const deviceId = requireDeviceId(rawDeviceId)

    const { deletedCount } = await SyncDevice.deleteOne({ userId, deviceId })
    if (deletedCount === 0) throw new CustomError(ERROR_MESSAGES.SYNC.DEVICE_NOT_FOUND, 404)
}

export const renameSyncDevice = async (userId: string, rawDeviceId: unknown, rawName: unknown): Promise<string | null> => {
    const deviceId = requireDeviceId(rawDeviceId)
    const name = parseDeviceName(rawName)

    const { matchedCount } = await SyncDevice.updateOne({ userId, deviceId }, name === null ? { $unset: { name: 1 } } : { $set: { name } })
    if (matchedCount === 0) throw new CustomError(ERROR_MESSAGES.SYNC.DEVICE_NOT_FOUND, 404)
    return name
}
