import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '@core/access/applyRowLevelSecurity'
import { USAGE_RESOURCES, type UsageResource } from '@core/billing/constants'

export interface IUsageCounter extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    resource: UsageResource
    value: number
    createdAt: Date
    updatedAt: Date
}

/**
 * A cache for cheap reads at enforcement time, never the source of truth: a reconciliation
 * recompute heals drift from the underlying rows.
 */
const UsageCounterSchema = new Schema<IUsageCounter>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        resource: { type: String, enum: USAGE_RESOURCES, required: true },
        value: { type: Number, default: 0, min: 0 },
    },
    { timestamps: true }
)

UsageCounterSchema.index({ userId: 1, resource: 1 }, { unique: true })

applyRowLevelSecurity(UsageCounterSchema)

const UsageCounter: Model<IUsageCounter> = mongoose.model<IUsageCounter>('UsageCounter', UsageCounterSchema)
export default UsageCounter
