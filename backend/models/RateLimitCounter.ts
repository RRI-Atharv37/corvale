import mongoose, { Document, Model, Schema } from 'mongoose'

/**
 * Backs the shared rate-limit store (SEC-26/S18): counters live in Mongo instead of
 * per-process memory, so horizontally-scaled instances share one budget per client
 * instead of each instance getting its own. Not user data — keys are namespaced per
 * limiter + client (usually an IP), never per userId — so this sits outside row-level
 * security, unlike every other model in this directory.
 */
export interface IRateLimitCounter extends Document {
    key: string
    points: number
    expiresAt: Date
}

const rateLimitCounterSchema = new Schema<IRateLimitCounter>({
    key: { type: String, required: true, unique: true },
    points: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
})

rateLimitCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const RateLimitCounter: Model<IRateLimitCounter> = mongoose.model<IRateLimitCounter>(
    'RateLimitCounter',
    rateLimitCounterSchema
)

export default RateLimitCounter
