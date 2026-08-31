import { describe, it, expect } from 'vitest'
import { mapWithConcurrency } from '../utils/concurrency'

describe('mapWithConcurrency (SEC-61)', () => {
    it('preserves input order in the result', async () => {
        const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10)
        expect(out).toEqual([10, 20, 30, 40, 50])
    })

    it('never runs more than `limit` tasks at once', async () => {
        let inFlight = 0
        let peak = 0
        await mapWithConcurrency(Array.from({ length: 30 }, (_, i) => i), 4, async () => {
            inFlight += 1
            peak = Math.max(peak, inFlight)
            await new Promise((r) => setTimeout(r, 1))
            inFlight -= 1
        })
        expect(peak).toBeLessThanOrEqual(4)
        expect(peak).toBeGreaterThan(1)
    })

    it('rejects with the first error and stops pulling new items', async () => {
        const started: number[] = []
        await expect(
            mapWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
                started.push(n)
                await new Promise((r) => setTimeout(r, 1))
                if (n === 1) throw new Error('boom')
                return n
            })
        ).rejects.toThrow('boom')
        // Two workers, so at most the two in-flight items plus nothing further.
        expect(started.length).toBeLessThan(8)
    })

    it('handles an empty array', async () => {
        expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([])
    })
})
