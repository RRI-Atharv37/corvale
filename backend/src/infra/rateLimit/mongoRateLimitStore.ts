import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit'
import RateLimitCounter from './rateLimitCounter.model'

/**
 * express-rate-limit `Store` backed by MongoDB (SEC-26/S18), replacing the default
 * in-memory store so hit counters are shared across horizontally-scaled instances.
 * Without this, each process keeps its own counter and scaling out silently multiplies
 * the effective limit by the instance count.
 *
 * `prefix` namespaces keys per logical limiter (e.g. "auth-login", "global") so
 * limiters that key on the same client (typically an IP) don't share a counter with each
 * other — mirroring how separate `MemoryStore` instances never did before this change.
 *
 * `increment` uses a single atomic aggregation-pipeline update rather than a read-then-write,
 * so two concurrent requests from the same client can't race past the actual limit.
 */
export class MongoRateLimitStore implements Store {
    readonly prefix: string
    readonly localKeys = false
    private windowMs = 60_000

    constructor(prefix: string) {
        this.prefix = prefix
    }

    init(options: Options): void {
        this.windowMs = options.windowMs
    }

    private scopedKey(key: string): string {
        return `${this.prefix}:${key}`
    }

    async increment(key: string): Promise<ClientRateLimitInfo> {
        const now = new Date()
        const windowMs = this.windowMs
        const scopedKey = this.scopedKey(key)

        const doc = await RateLimitCounter.findOneAndUpdate(
            { key: scopedKey },
            [
                {
                    $set: {
                        key: scopedKey,
                        points: {
                            $cond: [
                                { $lt: [{ $ifNull: ['$expiresAt', null] }, now] },
                                1,
                                { $add: [{ $ifNull: ['$points', 0] }, 1] },
                            ],
                        },
                        expiresAt: {
                            $cond: [
                                { $lt: [{ $ifNull: ['$expiresAt', null] }, now] },
                                new Date(now.getTime() + windowMs),
                                '$expiresAt',
                            ],
                        },
                    },
                },
            ],
            { upsert: true, new: true }
        )

        return { totalHits: doc!.points, resetTime: doc!.expiresAt }
    }

    async decrement(key: string): Promise<void> {
        await RateLimitCounter.updateOne({ key: this.scopedKey(key) }, { $inc: { points: -1 } })
    }

    async resetKey(key: string): Promise<void> {
        await RateLimitCounter.deleteOne({ key: this.scopedKey(key) })
    }

    async resetAll(): Promise<void> {
        await RateLimitCounter.deleteMany({ key: { $regex: `^${this.prefix}:` } })
    }
}
