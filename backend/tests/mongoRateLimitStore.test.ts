import { describe, it, expect } from 'vitest'
import { MongoRateLimitStore } from '@infra/rateLimit/mongoRateLimitStore'
import RateLimitCounter from '@infra/rateLimit/rateLimitCounter.model'

/**
 * Acceptance spec for the shared-store rate limiter (S18, SEC-26).
 *
 * Unit-level coverage for the express-rate-limit Store implementation backing the shared
 * limiter, independent of the HTTP-level cross-instance test in rateLimiting.test.ts.
 */
describe('MongoRateLimitStore (SEC-26, S18)', () => {
    const initStore = (prefix: string, windowMs = 60_000): MongoRateLimitStore => {
        const store = new MongoRateLimitStore(prefix)
        store.init({ windowMs } as Parameters<MongoRateLimitStore['init']>[0])
        return store
    }

    it('increments the hit count for repeated calls with the same key', async () => {
        const store = initStore('test-increment')

        const first = await store.increment('client-a')
        const second = await store.increment('client-a')

        expect(first.totalHits).toBe(1)
        expect(second.totalHits).toBe(2)
    })

    it('keeps separate counters for different keys under the same prefix', async () => {
        const store = initStore('test-separate-keys')

        await store.increment('client-a')
        const otherClient = await store.increment('client-b')

        expect(otherClient.totalHits).toBe(1)
    })

    it('namespaces keys by prefix so two limiters never share a counter for the same client', async () => {
        const storeOne = initStore('limiter-one')
        const storeTwo = initStore('limiter-two')

        await storeOne.increment('same-client')
        const secondLimiterFirstHit = await storeTwo.increment('same-client')

        expect(secondLimiterFirstHit.totalHits).toBe(1)
    })

    it('resets the counter once the window has elapsed', async () => {
        const store = initStore('test-window-expiry', 50)

        await store.increment('client-a')
        await new Promise((resolve) => setTimeout(resolve, 75))
        const afterExpiry = await store.increment('client-a')

        expect(afterExpiry.totalHits).toBe(1)
    })

    it('resetKey clears a single client without affecting others', async () => {
        const store = initStore('test-reset-key')

        await store.increment('client-a')
        await store.increment('client-b')
        await store.resetKey('client-a')

        const afterReset = await store.increment('client-a')
        expect(afterReset.totalHits).toBe(1)

        const untouched = await RateLimitCounter.findOne({ key: 'test-reset-key:client-b' })
        expect(untouched?.points).toBe(1)
    })

    it('decrement lowers the hit count', async () => {
        const store = initStore('test-decrement')

        await store.increment('client-a')
        await store.increment('client-a')
        await store.decrement('client-a')

        const doc = await RateLimitCounter.findOne({ key: 'test-decrement:client-a' })
        expect(doc?.points).toBe(1)
    })

    it('reports resetTime so RateLimit-Reset headers can be derived', async () => {
        const store = initStore('test-reset-time', 60_000)

        const { resetTime } = await store.increment('client-a')

        expect(resetTime).toBeInstanceOf(Date)
        expect((resetTime as Date).getTime()).toBeGreaterThan(Date.now())
    })
})
