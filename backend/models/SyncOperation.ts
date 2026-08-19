import mongoose, { Document, Model, Schema, Types } from 'mongoose'

export const SYNC_OP_STATUSES = ['applied', 'conflict', 'rejected'] as const
export type SyncOpStatus = (typeof SYNC_OP_STATUSES)[number]

/**
 * Idempotency ledger for POST /sync/push (Sprint 13.2). Unique on
 * (userId, opId) so a replayed op — the classic "client retried after a
 * timed-out response" scenario — returns the originally stored result
 * instead of re-running the op's side effects (no double-created document,
 * no double-applied balance delta).
 */
export interface ISyncOperation extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    opId: string
    entity: string
    operation: string
    status: SyncOpStatus
    resultId?: string | null
    message?: string | null
    createdAt: Date
    updatedAt: Date
}

const SyncOperationSchema = new Schema<ISyncOperation>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        opId: { type: String, required: true, trim: true },
        entity: { type: String, required: true, trim: true },
        operation: { type: String, required: true, trim: true },
        status: { type: String, enum: SYNC_OP_STATUSES, required: true },
        resultId: { type: String, default: null },
        message: { type: String, default: null },
    },
    { timestamps: true }
)

SyncOperationSchema.index({ userId: 1, opId: 1 }, { unique: true })

const SyncOperation: Model<ISyncOperation> = mongoose.model<ISyncOperation>(
    'SyncOperation',
    SyncOperationSchema
)
export default SyncOperation
