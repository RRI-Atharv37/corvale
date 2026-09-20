import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '@core/access/applyRowLevelSecurity'

export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export interface ISyncDevice extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    deviceId: string
    firstSeenAt: Date
    lastSeenAt: Date
    createdAt: Date
    updatedAt: Date
}

const SyncDeviceSchema = new Schema<ISyncDevice>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        deviceId: { type: String, required: true, match: DEVICE_ID_PATTERN },
        firstSeenAt: { type: Date, required: true },
        lastSeenAt: { type: Date, required: true },
    },
    { timestamps: true }
)

SyncDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true })

applyRowLevelSecurity(SyncDeviceSchema)

const SyncDevice: Model<ISyncDevice> = mongoose.model<ISyncDevice>('SyncDevice', SyncDeviceSchema)
export default SyncDevice
