import mongoose, { Document, Model, Schema, Types } from 'mongoose'

export interface IRefreshToken extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    tokenHash: string
    expiresAt: Date
    revokedAt?: Date | null
}

const refreshTokenSchema = new Schema<IRefreshToken>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        tokenHash: { type: String, required: true, unique: true },
        expiresAt: { type: Date, required: true },
        revokedAt: { type: Date, default: null },
    },
    { timestamps: true }
)

refreshTokenSchema.index({ userId: 1, revokedAt: 1 })
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const RefreshToken: Model<IRefreshToken> = mongoose.model<IRefreshToken>(
    'RefreshToken',
    refreshTokenSchema
)

export default RefreshToken
