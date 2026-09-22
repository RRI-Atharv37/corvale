import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { GRANDFATHER_KINDS, type GrandfatherKind } from '@core/billing/constants'

export const GRANDFATHER_BATCH_STATUSES = ['applied', 'reverted'] as const
export type GrandfatherBatchStatus = (typeof GRANDFATHER_BATCH_STATUSES)[number]

/**
 * One bulk grandfather assignment (M7.4). Holds the exact set of subscriptions it touched so a revert
 * only ever undoes this batch, never a different admin's later change to the same rows.
 */
export interface IGrandfatherBatch extends Document {
    _id: Types.ObjectId
    kind: GrandfatherKind
    registeredBefore: Date
    reason: string
    status: GrandfatherBatchStatus
    subscriptionIds: Types.ObjectId[]
    createdBy: Types.ObjectId
    createdAt: Date
    revertedBy: Types.ObjectId | null
    revertedAt: Date | null
    revertReason: string | null
}

const GrandfatherBatchSchema = new Schema<IGrandfatherBatch>(
    {
        kind: { type: String, enum: GRANDFATHER_KINDS, required: true, immutable: true },
        registeredBefore: { type: Date, required: true, immutable: true },
        reason: { type: String, required: true, immutable: true },
        status: { type: String, enum: GRANDFATHER_BATCH_STATUSES, default: 'applied' },
        subscriptionIds: { type: [mongoose.Schema.Types.ObjectId], required: true, immutable: true },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', required: true, immutable: true },
        revertedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
        revertedAt: { type: Date, default: null },
        revertReason: { type: String, default: null },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
)

GrandfatherBatchSchema.index({ createdAt: -1 })

// System collection, no userId: not tenant data, same treatment as AdminAuditLog / AdminSession.
const GrandfatherBatch: Model<IGrandfatherBatch> = mongoose.model<IGrandfatherBatch>('GrandfatherBatch', GrandfatherBatchSchema)
export default GrandfatherBatch
