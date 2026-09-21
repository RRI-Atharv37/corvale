import mongoose, { Document, Model, Schema, Types } from 'mongoose'

export interface IAdminSession extends Document {
    _id: Types.ObjectId
    adminId: Types.ObjectId
    refreshHash: string
    previousRefreshHash: string | null
    lastActivityAt: Date
    absoluteExpiresAt: Date
    revokedAt: Date | null
    stepUpAt: Date | null
    ip: string | null
    expireAt: Date
    createdAt: Date
    updatedAt: Date
}

/** Server-side so a session can be revoked instantly; the TTL index only tidies rows long since dead. */
const AdminSessionSchema = new Schema<IAdminSession>(
    {
        adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', required: true, index: true },
        refreshHash: { type: String, required: true, index: true },
        previousRefreshHash: { type: String, default: null, index: true },
        lastActivityAt: { type: Date, required: true },
        absoluteExpiresAt: { type: Date, required: true },
        revokedAt: { type: Date, default: null },
        stepUpAt: { type: Date, default: null },
        ip: { type: String, default: null },
        expireAt: { type: Date, required: true },
    },
    { timestamps: true }
)

AdminSessionSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

const AdminSession: Model<IAdminSession> = mongoose.model<IAdminSession>('AdminSession', AdminSessionSchema)
export default AdminSession
