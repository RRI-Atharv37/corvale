import { describe, expect, it } from 'vitest'

import { JobRun, getLatestJobRun, withJobRun } from '../jobRun.service'

/**
 * M7.2 - the scheduled scripts leave a trace, so the ops panel can show "last sweep" and, more importantly,
 * notice when nothing has run. Nothing schedules the sweeps yet, so silence has to be visible.
 */

describe('withJobRun', () => {
    it('records a successful run with its counts', async () => {
        const result = await withJobRun('sweep:billing', async () => ({ counts: { trialsExpired: 3, sent: 1 } }))

        expect(result.counts).toEqual({ trialsExpired: 3, sent: 1 })
        const row = await JobRun.findOne({ name: 'sweep:billing' }).lean()
        expect(row?.ok).toBe(true)
        expect(row?.counts).toEqual({ trialsExpired: 3, sent: 1 })
        expect(row?.exitCode).toBe(0)
        expect(row?.finishedAt).toBeInstanceOf(Date)
        expect(row!.finishedAt!.getTime()).toBeGreaterThanOrEqual(row!.startedAt.getTime())
    })

    it('records a failure, keeps a short message, and rethrows', async () => {
        await expect(
            withJobRun('reconcile:billing', async () => {
                throw new Error('provider down '.repeat(50))
            })
        ).rejects.toThrow('provider down')

        const row = await JobRun.findOne({ name: 'reconcile:billing' }).lean()
        expect(row?.ok).toBe(false)
        expect(row?.exitCode).toBe(1)
        expect(row?.error?.length).toBeLessThanOrEqual(200)
        expect(row?.finishedAt).toBeInstanceOf(Date)
    })

    it('a non-zero exit code from the job (for example failed deliveries) is a failed run', async () => {
        await withJobRun('sweep:billing', async () => ({ counts: { failed: 2 }, exitCode: 2 }))

        const row = await JobRun.findOne({ name: 'sweep:billing' }).lean()
        expect(row).toMatchObject({ ok: false, exitCode: 2, counts: { failed: 2 } })
    })

    it('keeps only whole-number counters, so a run can never carry an id or an address', async () => {
        await withJobRun('sweep:billing', async () => ({
            counts: { deleted: 1, email: 'leak@example.com', nested: { a: 1 }, nan: Number.NaN } as never,
        }))

        const row = await JobRun.findOne({ name: 'sweep:billing' }).lean()
        expect(row?.counts).toEqual({ deleted: 1 })
    })

    it('refuses a job name that is not on the list', async () => {
        await expect(withJobRun('drop:database' as never, async () => ({}))).rejects.toThrow()
    })
})

describe('getLatestJobRun', () => {
    it('returns the most recent run of a job, and null when it has never run', async () => {
        expect(await getLatestJobRun('sweep:billing')).toBeNull()

        await withJobRun('sweep:billing', async () => ({ counts: { n: 1 } }))
        await withJobRun('sweep:billing', async () => ({ counts: { n: 2 } }))
        await withJobRun('reconcile:billing', async () => ({ counts: { n: 9 } }))

        const latest = await getLatestJobRun('sweep:billing')
        expect(latest?.counts).toEqual({ n: 2 })
    })
})

describe('retention', () => {
    it('expires a run after 90 days with a TTL index', async () => {
        const indexes = await JobRun.collection.indexes()

        expect(indexes.some((index) => index.key.startedAt === 1 && index.expireAfterSeconds === 90 * 24 * 60 * 60)).toBe(true)
    })
})
