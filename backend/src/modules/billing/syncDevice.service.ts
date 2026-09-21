import { isDuplicateKeyError } from '@core/db/objectId'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import SyncDevice, { DEVICE_ID_PATTERN } from './syncDevice.model'

export const IMPLICIT_DEVICE_ID = '_legacy'

// A user-controlled id must not be able to grow a collection without bound.
export const MAX_REGISTERED_DEVICES = 100

export const parseDeviceId = (raw: unknown): string | undefined => {
    if (raw === undefined) return undefined
    if (typeof raw !== 'string' || !DEVICE_ID_PATTERN.test(raw)) {
        throw new CustomError(ERROR_MESSAGES.SYNC.INVALID_DEVICE_ID, 400)
    }
    return raw
}

export const registerSyncDevice = async (userId: string, deviceId: string | undefined, now: Date = new Date()): Promise<void> => {
    const id = deviceId ?? IMPLICIT_DEVICE_ID

    const known = await SyncDevice.updateOne({ userId, deviceId: id }, { $set: { lastSeenAt: now } })
    if (known.matchedCount > 0) return

    if ((await SyncDevice.countDocuments({ userId })) >= MAX_REGISTERED_DEVICES) return

    try {
        await SyncDevice.create({ userId, deviceId: id, firstSeenAt: now, lastSeenAt: now })
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
