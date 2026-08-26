import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemorySqliteDriver } from '../MemorySqliteDriver'
import { runMigrations } from '../migrations/runMigrations'
import { MIGRATIONS } from '../migrations/schema'
import type { LocalDb } from '../LocalDb'
import {
    DEFAULT_RECEIPT_CACHE_MAX_BYTES,
    deleteReceiptBlob,
    getReceiptBlob,
    getReceiptCacheUsageBytes,
    listReceiptBlobsForRecord,
    putReceiptBlob,
} from '../receiptBlobCache'

/**
 * Sprint 13.10: local receipt blob cache with an LRU size cap, backed by
 * migration 0004's extension of the `_blobs` table (scaffolded but unused
 * since 0001_init.sql) with `lastAccessedAt`.
 */
describe('receiptBlobCache', () => {
    const freshDb = async (): Promise<LocalDb> => {
        const db = await MemorySqliteDriver.create()
        await runMigrations(db, MIGRATIONS)
        return db
    }

    const bytesOf = (n: number): Uint8Array => new Uint8Array(n).fill(7)

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('round-trips a put blob through get, preserving bytes/mimeType/recordId', async () => {
        const db = await freshDb()
        const data = bytesOf(1024)

        const cached = await putReceiptBlob(db, { recordId: 'txn-1', mimeType: 'image/png', data })
        const fetched = await getReceiptBlob(db, cached.id)

        expect(fetched).not.toBeNull()
        expect(fetched?.recordId).toBe('txn-1')
        expect(fetched?.mimeType).toBe('image/png')
        expect(fetched?.sizeBytes).toBe(1024)
        expect(Array.from(fetched?.data ?? [])).toEqual(Array.from(data))

        await db.close()
    })

    it('returns null for an id that was never cached', async () => {
        const db = await freshDb()
        expect(await getReceiptBlob(db, 'does-not-exist')).toBeNull()
        await db.close()
    })

    it('get refreshes lastAccessedAt (LRU touch)', async () => {
        const db = await freshDb()
        const cached = await putReceiptBlob(db, { recordId: 'txn-1', mimeType: 'image/png', data: bytesOf(10) })
        const initial = cached.lastAccessedAt

        vi.setSystemTime(new Date('2026-01-01T01:00:00.000Z'))
        const touched = await getReceiptBlob(db, cached.id)

        expect(touched?.lastAccessedAt).not.toBe(initial)
        expect(new Date(touched?.lastAccessedAt ?? 0).getTime()).toBeGreaterThan(new Date(initial).getTime())

        await db.close()
    })

    it('deleteReceiptBlob removes the row so a later get returns null', async () => {
        const db = await freshDb()
        const cached = await putReceiptBlob(db, { recordId: 'txn-1', mimeType: 'image/png', data: bytesOf(10) })

        await deleteReceiptBlob(db, cached.id)

        expect(await getReceiptBlob(db, cached.id)).toBeNull()
        await db.close()
    })

    it('getReceiptCacheUsageBytes sums sizeBytes across cached blobs', async () => {
        const db = await freshDb()
        await putReceiptBlob(db, { recordId: 'txn-1', mimeType: 'image/png', data: bytesOf(1000) })
        await putReceiptBlob(db, { recordId: 'txn-2', mimeType: 'image/png', data: bytesOf(2000) })

        expect(await getReceiptCacheUsageBytes(db)).toBe(3000)

        await db.close()
    })

    it('listReceiptBlobsForRecord returns only blobs for that record, oldest first', async () => {
        const db = await freshDb()
        await putReceiptBlob(db, { recordId: 'txn-1', mimeType: 'image/png', data: bytesOf(10) })
        vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))
        await putReceiptBlob(db, { recordId: 'txn-2', mimeType: 'image/png', data: bytesOf(10) })
        vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'))
        const second = await putReceiptBlob(db, { recordId: 'txn-1', mimeType: 'application/pdf', data: bytesOf(10) })

        const forTxn1 = await listReceiptBlobsForRecord(db, 'txn-1')
        expect(forTxn1.map((b) => b.id)).toEqual([forTxn1[0].id, second.id])
        expect(forTxn1.every((b) => b.recordId === 'txn-1')).toBe(true)

        await db.close()
    })

    it('defaults the LRU cap to 50MB', () => {
        expect(DEFAULT_RECEIPT_CACHE_MAX_BYTES).toBe(50 * 1024 * 1024)
    })

    describe('LRU eviction', () => {
        it('evicts the least-recently-accessed blob first when over the cap', async () => {
            const db = await freshDb()
            const maxTotalBytes = 25

            const oldest = await putReceiptBlob(db, { recordId: 'txn-1', mimeType: 'image/png', data: bytesOf(10), maxTotalBytes })
            vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))
            const middle = await putReceiptBlob(db, { recordId: 'txn-2', mimeType: 'image/png', data: bytesOf(10), maxTotalBytes })
            vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'))
            // Pushes total to 30 bytes, over the 25-byte cap - oldest (untouched) should go.
            const newest = await putReceiptBlob(db, { recordId: 'txn-3', mimeType: 'image/png', data: bytesOf(10), maxTotalBytes })

            expect(await getReceiptBlob(db, oldest.id)).toBeNull()
            expect(await getReceiptBlob(db, middle.id)).not.toBeNull()
            expect(await getReceiptBlob(db, newest.id)).not.toBeNull()
            expect(await getReceiptCacheUsageBytes(db)).toBeLessThanOrEqual(maxTotalBytes)

            await db.close()
        })

        it('a recent get() protects a blob from eviction over an older, untouched one', async () => {
            const db = await freshDb()
            const maxTotalBytes = 25

            const first = await putReceiptBlob(db, { recordId: 'txn-1', mimeType: 'image/png', data: bytesOf(10), maxTotalBytes })
            vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))
            const second = await putReceiptBlob(db, { recordId: 'txn-2', mimeType: 'image/png', data: bytesOf(10), maxTotalBytes })

            // Touch `first` so it's now more recently accessed than `second`.
            vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'))
            await getReceiptBlob(db, first.id)

            vi.setSystemTime(new Date('2026-01-01T00:00:03.000Z'))
            await putReceiptBlob(db, { recordId: 'txn-3', mimeType: 'image/png', data: bytesOf(10), maxTotalBytes })

            expect(await getReceiptBlob(db, first.id)).not.toBeNull()
            expect(await getReceiptBlob(db, second.id)).toBeNull()

            await db.close()
        })

        it('does not evict a blob with a pending/uploading receipt upload queued against it, even when it is LRU-oldest', async () => {
            const db = await freshDb()
            const maxTotalBytes = 15

            const protectedBlob = await putReceiptBlob(db, {
                recordId: 'txn-1',
                mimeType: 'image/png',
                data: bytesOf(10),
                maxTotalBytes,
            })
            await db.exec(
                `INSERT INTO _receipt_uploads (id, localBlobId, transactionId, filename, mimeType, status, attempts, createdAt)
                 VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`,
                ['upload-1', protectedBlob.id, 'txn-1', 'receipt.png', 'image/png', new Date().toISOString()]
            )

            vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))
            // Pushes total to 20 bytes, over the 15-byte cap. `protectedBlob` is the LRU-oldest
            // candidate but is protected by its in-flight upload, so the newly-added (unprotected)
            // blob is evicted instead, even though it was only just added.
            const other = await putReceiptBlob(db, {
                recordId: 'txn-2',
                mimeType: 'image/png',
                data: bytesOf(10),
                maxTotalBytes,
            })

            expect(await getReceiptBlob(db, protectedBlob.id)).not.toBeNull()
            expect(await getReceiptBlob(db, other.id)).toBeNull()

            await db.close()
        })

        it('evicts a protected blob once its upload resolves and the queue row is gone', async () => {
            const db = await freshDb()
            const maxTotalBytes = 15

            const blob = await putReceiptBlob(db, { recordId: 'txn-1', mimeType: 'image/png', data: bytesOf(10), maxTotalBytes })
            await db.exec(
                `INSERT INTO _receipt_uploads (id, localBlobId, transactionId, filename, mimeType, status, attempts, createdAt)
                 VALUES (?, ?, ?, ?, ?, 'uploaded', 0, ?)`,
                ['upload-1', blob.id, 'txn-1', 'receipt.png', 'image/png', new Date().toISOString()]
            )

            vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))
            await putReceiptBlob(db, { recordId: 'txn-2', mimeType: 'image/png', data: bytesOf(10), maxTotalBytes })

            // `uploaded` is a resolved status, not `pending`/`uploading`, so the blob is no longer protected.
            expect(await getReceiptBlob(db, blob.id)).toBeNull()

            await db.close()
        })
    })
})
