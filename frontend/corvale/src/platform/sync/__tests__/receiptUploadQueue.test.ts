import { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReceiptUploadQueue, createSqliteReceiptUploadStore } from '../receiptUploadQueue'
import type { ReceiptUploadEntry, ReceiptUploadQueue, UploadOutcome } from '../receiptUploadQueue'
import { MemorySqliteDriver } from '../../db/MemorySqliteDriver'
import { runMigrations } from '../../db/migrations/runMigrations'
import { MIGRATIONS } from '../../db/migrations/schema'

// Mirrors sync/__tests__/outbox.test.ts's design decisions: injected store defaults to an
// in-memory implementation, `flush` takes an injected upload function so the state machine is
// testable without a real LocalDb/network, and offline/backoff behavior is asserted with fake
// timers + `navigator.onLine`.

const setOnline = (online: boolean): void => {
    Object.defineProperty(navigator, 'onLine', { value: online, writable: true, configurable: true })
}

const uploadOneAsSuccess = async (entry: ReceiptUploadEntry): Promise<UploadOutcome> => ({
    status: 'uploaded',
    receiptId: `receipt-${entry.id}`,
})

describe('receiptUploadQueue', () => {
    let queue: ReceiptUploadQueue

    beforeEach(() => {
        vi.useFakeTimers()
        setOnline(true)
        queue = createReceiptUploadQueue()
    })

    afterEach(() => {
        vi.useRealTimers()
        setOnline(true)
    })

    describe('enqueue', () => {
        it('starts a new entry as pending with zero attempts', async () => {
            const entry = await queue.enqueue({
                localBlobId: 'blob-1',
                transactionId: 'txn-1',
                filename: 'receipt.png',
                mimeType: 'image/png',
            })

            expect(entry.status).toBe('pending')
            expect(entry.attempts).toBe(0)
            expect(entry.rejectionReason).toBeNull()
            expect(entry.serverReceiptId).toBeNull()
        })

        it('listPending returns only unresolved (pending/uploading) entries', async () => {
            await queue.enqueue({ localBlobId: 'b1', transactionId: 'txn-1', filename: 'a.png', mimeType: 'image/png' })
            await queue.enqueue({ localBlobId: 'b2', transactionId: 'txn-2', filename: 'b.png', mimeType: 'image/png' })

            expect(await queue.listPending()).toHaveLength(2)
        })

        it('listForTransaction scopes to one transaction, regardless of status', async () => {
            await queue.enqueue({ localBlobId: 'b1', transactionId: 'txn-1', filename: 'a.png', mimeType: 'image/png' })
            await queue.enqueue({ localBlobId: 'b2', transactionId: 'txn-2', filename: 'b.png', mimeType: 'image/png' })

            const forTxn1 = await queue.listForTransaction('txn-1')
            expect(forTxn1).toHaveLength(1)
            expect(forTxn1[0].transactionId).toBe('txn-1')
        })
    })

    describe('flush - success', () => {
        it('marks an uploaded entry with its server receipt id and removes it from listPending', async () => {
            await queue.enqueue({ localBlobId: 'b1', transactionId: 'txn-1', filename: 'a.png', mimeType: 'image/png' })

            await queue.flush(async (entry) => ({ status: 'uploaded', receiptId: `receipt-${entry.id}` }))

            expect(await queue.listPending()).toEqual([])
            const [resolved] = await queue.listForTransaction('txn-1')
            expect(resolved.status).toBe('uploaded')
            expect(resolved.serverReceiptId).toBe(`receipt-${resolved.id}`)
        })

        it('uploads multiple queued entries in enqueue order', async () => {
            await queue.enqueue({ localBlobId: 'b1', transactionId: 'txn-1', filename: 'a.png', mimeType: 'image/png' })
            await queue.enqueue({ localBlobId: 'b2', transactionId: 'txn-1', filename: 'b.png', mimeType: 'image/png' })

            const uploadFn = vi.fn(async (entry: ReceiptUploadEntry) => ({
                status: 'uploaded' as const,
                receiptId: `receipt-${entry.id}`,
            }))
            await queue.flush(uploadFn)

            expect(uploadFn).toHaveBeenCalledTimes(2)
            expect(uploadFn.mock.calls[0][0].filename).toBe('a.png')
            expect(uploadFn.mock.calls[1][0].filename).toBe('b.png')
        })

        it('does nothing when there are no pending entries', async () => {
            const uploadFn = vi.fn(async () => ({ status: 'uploaded' as const, receiptId: 'r1' }))
            await queue.flush(uploadFn)
            expect(uploadFn).not.toHaveBeenCalled()
        })
    })

    describe('flush - scan rejection (server verdict, terminal)', () => {
        it('marks a rejected entry with its reason and never retries it', async () => {
            await queue.enqueue({ localBlobId: 'b1', transactionId: 'txn-1', filename: 'virus.png', mimeType: 'image/png' })

            const rejecting = vi.fn(async () => ({
                status: 'rejected' as const,
                reason: 'Receipt file failed security scan',
            }))
            await queue.flush(rejecting)

            const [entry] = await queue.listForTransaction('txn-1')
            expect(entry.status).toBe('rejected')
            expect(entry.rejectionReason).toBe('Receipt file failed security scan')

            rejecting.mockClear()
            await queue.flush(rejecting)
            expect(rejecting).not.toHaveBeenCalled()
        })

        it('does not surface a rejected entry via listPending, so it cannot silently block other uploads', async () => {
            await queue.enqueue({ localBlobId: 'b1', transactionId: 'txn-1', filename: 'virus.png', mimeType: 'image/png' })
            await queue.flush(async () => ({ status: 'rejected', reason: 'infected' }))

            expect(await queue.listPending()).toEqual([])
        })

        it('a scan-service-unavailable rejection is also terminal, not retried', async () => {
            await queue.enqueue({ localBlobId: 'b1', transactionId: 'txn-1', filename: 'a.png', mimeType: 'image/png' })

            const rejecting = vi.fn(async () => ({
                status: 'rejected' as const,
                reason: 'Receipt upload temporarily unavailable; try again later',
            }))
            await queue.flush(rejecting)
            await queue.flush(rejecting)

            expect(rejecting).toHaveBeenCalledTimes(1)
        })
    })

    describe('flush - transient failure (retry with backoff)', () => {
        it('does not retry a transient failure immediately on the next flush', async () => {
            await queue.enqueue({ localBlobId: 'b1', transactionId: 'txn-1', filename: 'a.png', mimeType: 'image/png' })

            const retrying = vi.fn(async () => ({ status: 'retry' as const, error: 'network timeout' }))
            await queue.flush(retrying)
            expect(retrying).toHaveBeenCalledTimes(1)

            retrying.mockClear()
            await queue.flush(retrying)
            expect(retrying).not.toHaveBeenCalled()
        })

        it('retries only after the backoff window elapses, then succeeds', async () => {
            await queue.enqueue({ localBlobId: 'b1', transactionId: 'txn-1', filename: 'a.png', mimeType: 'image/png' })

            const failThenSucceed = vi
                .fn()
                .mockResolvedValueOnce({ status: 'retry', error: 'network timeout' })
                .mockResolvedValue({ status: 'uploaded', receiptId: 'r1' })

            await queue.flush(failThenSucceed)
            expect(failThenSucceed).toHaveBeenCalledTimes(1)

            vi.advanceTimersByTime(999)
            await queue.flush(failThenSucceed)
            expect(failThenSucceed).toHaveBeenCalledTimes(1)

            vi.advanceTimersByTime(2)
            await queue.flush(failThenSucceed)
            expect(failThenSucceed).toHaveBeenCalledTimes(2)

            expect(await queue.listPending()).toEqual([])
        })

        it('keeps a retrying entry in pending status with an incremented attempt count', async () => {
            await queue.enqueue({ localBlobId: 'b1', transactionId: 'txn-1', filename: 'a.png', mimeType: 'image/png' })

            await queue.flush(async () => ({ status: 'retry', error: 'network timeout' }))

            const [entry] = await queue.listPending()
            expect(entry.status).toBe('pending')
            expect(entry.attempts).toBe(1)
        })
    })

    describe('offline behavior', () => {
        it('is a no-op when offline', async () => {
            setOnline(false)
            await queue.enqueue({ localBlobId: 'b1', transactionId: 'txn-1', filename: 'a.png', mimeType: 'image/png' })

            const uploadFn = vi.fn(uploadOneAsSuccess)
            await queue.flush(uploadFn)

            expect(uploadFn).not.toHaveBeenCalled()
            expect(await queue.listPending()).toHaveLength(1)
        })

        it('flushes once connectivity returns', async () => {
            setOnline(false)
            await queue.enqueue({ localBlobId: 'b1', transactionId: 'txn-1', filename: 'a.png', mimeType: 'image/png' })

            const uploadFn = vi.fn(async (entry: ReceiptUploadEntry) => ({
                status: 'uploaded' as const,
                receiptId: `receipt-${entry.id}`,
            }))
            await queue.flush(uploadFn)
            expect(uploadFn).not.toHaveBeenCalled()

            setOnline(true)
            await queue.flush(uploadFn)
            expect(uploadFn).toHaveBeenCalledTimes(1)
        })

        it('still allows enqueueing while offline (unlike workspace-scoped outbox writes)', async () => {
            setOnline(false)
            const entry = await queue.enqueue({
                localBlobId: 'b1',
                transactionId: 'txn-1',
                filename: 'a.png',
                mimeType: 'image/png',
            })
            expect(entry.status).toBe('pending')
        })
    })

    describe('remove (dismiss)', () => {
        it('removes an entry so it no longer appears in listForTransaction', async () => {
            const entry = await queue.enqueue({
                localBlobId: 'b1',
                transactionId: 'txn-1',
                filename: 'a.png',
                mimeType: 'image/png',
            })

            await queue.remove(entry.id)

            expect(await queue.listForTransaction('txn-1')).toEqual([])
        })
    })
})

/**
 * Proves migration 0004's `_receipt_uploads` table (see
 * db/migrations/sql/0004_receipts.sql) round-trips through the real SQLite
 * store, not just the in-memory one used by the state-machine tests above -
 * same pattern as db/repositories/__tests__/transactionTemplates.test.ts for
 * migration 0003.
 */
describe('createSqliteReceiptUploadStore (migration 0004)', () => {
    it('persists an enqueued entry and reflects status/backoff updates', async () => {
        const db = await MemorySqliteDriver.create()
        await runMigrations(db, MIGRATIONS)
        const queue = createReceiptUploadQueue(createSqliteReceiptUploadStore(db))

        const entry = await queue.enqueue({
            localBlobId: 'blob-1',
            transactionId: 'txn-1',
            filename: 'receipt.png',
            mimeType: 'image/png',
        })
        expect((await queue.listForTransaction('txn-1'))[0]).toMatchObject({ id: entry.id, status: 'pending' })

        await queue.flush(async () => ({ status: 'rejected', reason: 'Receipt file failed security scan' }))

        const [persisted] = await queue.listForTransaction('txn-1')
        expect(persisted.status).toBe('rejected')
        expect(persisted.rejectionReason).toBe('Receipt file failed security scan')

        await db.close()
    })
})

describe('uploadReceiptEntryToServer - scan rejection classification', () => {
    // Isolated `vi.resetModules` + dynamic import so the axiosInstance mock below only affects
    // this describe block's tests, not the pure-state-machine tests above.
    const baseEntry: ReceiptUploadEntry = {
        id: 'upload-1',
        localBlobId: 'blob-1',
        transactionId: 'txn-1',
        filename: 'receipt.png',
        mimeType: 'image/png',
        status: 'uploading',
        rejectionReason: null,
        serverReceiptId: null,
        attempts: 0,
        createdAt: new Date().toISOString(),
        nextAttemptAt: null,
    }

    beforeEach(() => {
        // `../receiptUploadQueue` (and its `axiosInstance` import) is already cached from the
        // static import at the top of this file, so a dynamic `import()` below would otherwise
        // return that cached module and ignore `vi.doMock` entirely - reset first so each test's
        // dynamic import re-evaluates against its own mocked axiosInstance.
        vi.resetModules()
    })

    afterEach(() => {
        vi.doUnmock('../../utils/axiosInstance')
        vi.resetModules()
    })

    it('maps a virus-scan HTTP rejection (400, response present) to a terminal "rejected" outcome', async () => {
        const scanRejection = new AxiosError('Request failed with status code 400')
        scanRejection.response = {
            status: 400,
            data: { success: false, message: 'Receipt file failed security scan' },
        } as never

        vi.doMock('@lib/axiosInstance', () => ({
            default: { post: vi.fn().mockRejectedValue(scanRejection) },
        }))

        const { uploadReceiptEntryToServer } = await import('../receiptUploadQueue')
        const outcome = await uploadReceiptEntryToServer(baseEntry, new Blob(['x']))

        expect(outcome).toEqual({ status: 'rejected', reason: 'Receipt file failed security scan' })
    })

    it('maps a fail-closed scan-unavailable HTTP response (503) to a terminal "rejected" outcome, not a retry', async () => {
        const scanUnavailable = new AxiosError('Request failed with status code 503')
        scanUnavailable.response = {
            status: 503,
            data: { success: false, message: 'Receipt upload temporarily unavailable; try again later' },
        } as never

        vi.doMock('@lib/axiosInstance', () => ({
            default: { post: vi.fn().mockRejectedValue(scanUnavailable) },
        }))

        const { uploadReceiptEntryToServer } = await import('../receiptUploadQueue')
        const outcome = await uploadReceiptEntryToServer(baseEntry, new Blob(['x']))

        expect(outcome).toEqual({
            status: 'rejected',
            reason: 'Receipt upload temporarily unavailable; try again later',
        })
    })

    it('maps a true network error (no response reached the server) to a "retry" outcome', async () => {
        const networkError = new AxiosError('Network Error')
        networkError.response = undefined

        vi.doMock('@lib/axiosInstance', () => ({
            default: { post: vi.fn().mockRejectedValue(networkError) },
        }))

        const { uploadReceiptEntryToServer } = await import('../receiptUploadQueue')
        const outcome = await uploadReceiptEntryToServer(baseEntry, new Blob(['x']))

        expect(outcome.status).toBe('retry')
    })

    it('on success, uploads then attaches to the transaction and returns the server receipt id', async () => {
        const post = vi.fn()
        post.mockResolvedValueOnce({ success: true, data: { _id: 'receipt-server-1' } })
        post.mockResolvedValueOnce({ success: true, data: {} })

        vi.doMock('@lib/axiosInstance', () => ({ default: { post } }))

        const { uploadReceiptEntryToServer } = await import('../receiptUploadQueue')
        const outcome = await uploadReceiptEntryToServer(baseEntry, new Blob(['x']))

        expect(outcome).toEqual({ status: 'uploaded', receiptId: 'receipt-server-1' })
        expect(post).toHaveBeenCalledTimes(2)
        expect(post.mock.calls[1][0]).toContain('txn-1')
        expect(post.mock.calls[1][1]).toEqual({ receiptId: 'receipt-server-1' })
    })

    it('when the attach call fails with a network error, retries with the already-created receipt id instead of re-uploading', async () => {
        const networkError = new AxiosError('Network Error')
        networkError.response = undefined

        const post = vi.fn()
        post.mockResolvedValueOnce({ success: true, data: { _id: 'receipt-server-1' } })
        post.mockRejectedValueOnce(networkError)

        vi.doMock('@lib/axiosInstance', () => ({ default: { post } }))

        const { uploadReceiptEntryToServer } = await import('../receiptUploadQueue')
        const outcome = await uploadReceiptEntryToServer(baseEntry, new Blob(['x']))

        expect(post).toHaveBeenCalledTimes(2)
        expect(outcome).toEqual({
            status: 'retry',
            error: expect.any(String),
            receiptId: 'receipt-server-1',
        })
    })

    it('resumes at the attach step (skips re-uploading) when the entry already has a serverReceiptId from a prior partial attempt', async () => {
        const post = vi.fn().mockResolvedValueOnce({ success: true, data: {} })
        vi.doMock('@lib/axiosInstance', () => ({ default: { post } }))

        const { uploadReceiptEntryToServer } = await import('../receiptUploadQueue')
        const outcome = await uploadReceiptEntryToServer(
            { ...baseEntry, serverReceiptId: 'receipt-server-1' },
            new Blob(['x'])
        )

        expect(outcome).toEqual({ status: 'uploaded', receiptId: 'receipt-server-1' })
        expect(post).toHaveBeenCalledTimes(1)
        expect(post.mock.calls[0][0]).toContain('txn-1')
        expect(post.mock.calls[0][1]).toEqual({ receiptId: 'receipt-server-1' })
    })

    it('flush() persists the partially-created receipt id onto the entry so a later retry does not re-upload', async () => {
        const networkError = new AxiosError('Network Error')
        networkError.response = undefined

        const { createReceiptUploadQueue, createMemoryReceiptUploadStore } = await import('../receiptUploadQueue')
        const store = createMemoryReceiptUploadStore()
        const queue = createReceiptUploadQueue(store)
        const entry = await queue.enqueue({
            localBlobId: 'blob-1',
            transactionId: 'txn-1',
            filename: 'receipt.png',
            mimeType: 'image/png',
        })

        await queue.flush(async () => ({
            status: 'retry',
            error: 'Network Error',
            receiptId: 'receipt-server-1',
        }))

        const [updated] = await queue.listForTransaction('txn-1')
        expect(updated.id).toBe(entry.id)
        expect(updated.status).toBe('pending')
        expect(updated.serverReceiptId).toBe('receipt-server-1')
    })
})
