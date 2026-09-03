import { describe, it, expect, beforeEach } from 'vitest'

import { Transaction } from '@modules/transactions'
import { Tag } from '@modules/tags'
import { purgeExpiredTombstones } from '../../../../utils/purgeTombstones'
import { TOMBSTONE_RETENTION_DAYS } from '@core/softDelete/softDelete'

/**
 * SEC-54: `purge:tombstones` is a destructive, RLS-bypassing script with no `:dry-run` counterpart
 * (every other destructive script in package.json has one) and no `--retention-days` validation —
 * `--retention-days=0` permanently purges every tombstone for every user.
 */

const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 60 * 60 * 1000)

const seedRow = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: any,
    deletedAt: Date | null
): Promise<unknown> =>
    model.collection.insertOne({
        userId: 'user-a',
        deletedAt,
        createdAt: daysAgo(400),
        updatedAt: daysAgo(400),
    })

beforeEach(async () => {
    await seedRow(Transaction, daysAgo(TOMBSTONE_RETENTION_DAYS + 10)) // expired tombstone
    await seedRow(Transaction, daysAgo(1)) // fresh tombstone
    await seedRow(Transaction, null) // live row
    await seedRow(Tag, daysAgo(TOMBSTONE_RETENTION_DAYS + 10)) // expired tombstone
})

describe('purgeExpiredTombstones — retention validation (SEC-54)', () => {
    for (const bad of [0, -1, -90, NaN]) {
        it(`rejects a non-positive / non-finite retention window (${bad})`, async () => {
            await expect(purgeExpiredTombstones(bad)).rejects.toThrow(/retention/i)
        })
    }

    it('does not delete anything when the retention window is invalid', async () => {
        await purgeExpiredTombstones(0).catch(() => undefined)
        expect(await Transaction.collection.countDocuments({})).toBe(3)
        expect(await Tag.collection.countDocuments({})).toBe(1)
    })
})

describe('purgeExpiredTombstones — dry run (SEC-54)', () => {
    it('reports the rows that would be purged without deleting them', async () => {
        const results = await purgeExpiredTombstones(TOMBSTONE_RETENTION_DAYS, { dryRun: true })

        const byModel = Object.fromEntries(results.map((r) => [r.model, r.deletedCount]))
        expect(byModel.Transaction).toBe(1)
        expect(byModel.Tag).toBe(1)

        // Nothing actually removed.
        expect(await Transaction.collection.countDocuments({})).toBe(3)
        expect(await Tag.collection.countDocuments({})).toBe(1)
    })
})

describe('purgeExpiredTombstones — real run (regression)', () => {
    it('permanently removes only tombstones older than the retention window', async () => {
        const results = await purgeExpiredTombstones(TOMBSTONE_RETENTION_DAYS)

        const byModel = Object.fromEntries(results.map((r) => [r.model, r.deletedCount]))
        expect(byModel.Transaction).toBe(1)
        expect(byModel.Tag).toBe(1)

        // The fresh tombstone and the live row survive.
        expect(await Transaction.collection.countDocuments({})).toBe(2)
        expect(await Tag.collection.countDocuments({})).toBe(0)
    })
})
