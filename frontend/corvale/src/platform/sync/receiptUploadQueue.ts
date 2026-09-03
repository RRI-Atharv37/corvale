import type { LocalDb, LocalDbRow } from '../db/LocalDb'
import { tableInvalidationBus } from '@lib/tableInvalidationBus'
import { getReceiptBlob } from '../db/receiptBlobCache'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { getApiErrorMessage } from '@lib/apiError'
import { unwrapApiData } from '@lib/apiHelpers'
import { isNetworkError } from '../offline/reachability'
import type { ApiResponse, Receipt } from '@lib/types/api'

/**
 * Sprint 13.10: queued receipt upload.
 *
 * Deliberately NOT the JSON-op `_outbox` queue (`sync/outbox.ts`) - Receipt
 * is intentionally excluded from `backend/services/syncService.ts`'s
 * `SYNC_ENTITIES` (receipt metadata never flows through `/sync/push`;
 * receipts are binary multipart uploads to
 * `backend/controllers/receiptController.ts`'s `uploadReceipt`, not JSON
 * ops). This is a small, purpose-built parallel queue instead: one row per
 * pending upload, draining via multipart POST once online. It mirrors the
 * outbox's FIFO + retry-with-backoff shape for consistency, but has no
 * per-entity batching - each queued upload is an independent file, sent as
 * its own request.
 *
 * State machine: `pending -> uploading -> uploaded | rejected`, or
 * `uploading -> pending` again on a transient failure (backoff via
 * `nextAttemptAt`, same 1s-doubling curve as the outbox). `rejected` is
 * terminal: a server verdict (virus-scan rejection, or a fail-closed
 * "scan service unavailable" response - see `uploadReceiptEntryToServer`)
 * is never retried, and `rejectionReason` carries the user-visible reason.
 * Only a genuine network error (request never reached the server) is
 * `retry`.
 */

export type ReceiptUploadStatus = 'pending' | 'uploading' | 'uploaded' | 'rejected'

export interface ReceiptUploadEntry {
    id: string
    localBlobId: string
    transactionId: string
    filename: string
    mimeType: string
    status: ReceiptUploadStatus
    rejectionReason: string | null
    serverReceiptId: string | null
    attempts: number
    createdAt: string
    nextAttemptAt: number | null
}

export interface EnqueueUploadInput {
    localBlobId: string
    transactionId: string
    filename: string
    mimeType: string
}

export type UploadOutcome =
    | { status: 'uploaded'; receiptId: string }
    | { status: 'rejected'; reason: string }
    | { status: 'retry'; error: string; receiptId?: string }

export interface ReceiptUploadQueue {
    enqueue(input: EnqueueUploadInput): Promise<ReceiptUploadEntry>
    /** Unresolved entries only (`pending`/`uploading`) - mirrors `Outbox.listPending()`. */
    listPending(): Promise<ReceiptUploadEntry[]>
    /** Every entry for a transaction regardless of status, so the UI can render rejected/queued tiles too. */
    listForTransaction(transactionId: string): Promise<ReceiptUploadEntry[]>
    flush(uploadFn: (entry: ReceiptUploadEntry) => Promise<UploadOutcome>): Promise<void>
    /** Dismisses a resolved (`uploaded`/`rejected`) entry, or cancels a still-queued one, from the UI. */
    remove(id: string): Promise<void>
}

/** Pluggable persistence, mirroring `sync/outbox.ts`'s `OutboxStore`. */
export interface ReceiptUploadStore {
    insert(entry: ReceiptUploadEntry): Promise<void>
    list(): Promise<ReceiptUploadEntry[]>
    update(id: string, patch: Partial<ReceiptUploadEntry>): Promise<void>
    remove(id: string): Promise<void>
}

const BASE_BACKOFF_MS = 1000
const computeBackoffDelay = (attempts: number): number => BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1)
const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine

export const createMemoryReceiptUploadStore = (): ReceiptUploadStore => {
    const entries = new Map<string, ReceiptUploadEntry>()
    let sequence = 0
    const order = new Map<string, number>()

    return {
        async insert(entry) {
            entries.set(entry.id, { ...entry })
            order.set(entry.id, sequence++)
        },
        async list() {
            return [...entries.values()].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        },
        async update(id, patch) {
            const existing = entries.get(id)
            if (existing) {
                entries.set(id, { ...existing, ...patch })
            }
        },
        async remove(id) {
            entries.delete(id)
            order.delete(id)
        },
    }
}

interface ReceiptUploadRow extends LocalDbRow {
    id: string
    localBlobId: string
    transactionId: string
    filename: string
    mimeType: string
    status: string
    rejectionReason: string | null
    serverReceiptId: string | null
    attempts: number
    createdAt: string
    nextAttemptAt: string | null
}

const rowToEntry = (row: ReceiptUploadRow): ReceiptUploadEntry => ({
    id: row.id,
    localBlobId: row.localBlobId,
    transactionId: row.transactionId,
    filename: row.filename,
    mimeType: row.mimeType,
    status: row.status as ReceiptUploadStatus,
    rejectionReason: row.rejectionReason,
    serverReceiptId: row.serverReceiptId,
    attempts: row.attempts,
    createdAt: row.createdAt,
    nextAttemptAt: row.nextAttemptAt === null ? null : Number(row.nextAttemptAt),
})

/** Backs `ReceiptUploadQueue` with the local SQLite `_receipt_uploads` table (see `db/migrations/sql/0004_receipts.sql`). */
export const createSqliteReceiptUploadStore = (db: LocalDb): ReceiptUploadStore => ({
    async insert(entry) {
        await db.exec(
            `INSERT INTO _receipt_uploads (id, localBlobId, transactionId, filename, mimeType, status, rejectionReason, serverReceiptId, attempts, createdAt, nextAttemptAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                entry.id,
                entry.localBlobId,
                entry.transactionId,
                entry.filename,
                entry.mimeType,
                entry.status,
                entry.rejectionReason,
                entry.serverReceiptId,
                entry.attempts,
                entry.createdAt,
                entry.nextAttemptAt === null ? null : String(entry.nextAttemptAt),
            ]
        )
        tableInvalidationBus.publish('_receipt_uploads')
    },

    async list() {
        const rows = await db.select<ReceiptUploadRow>(
            'SELECT * FROM _receipt_uploads ORDER BY createdAt ASC, rowid ASC'
        )
        return rows.map(rowToEntry)
    },

    async update(id, patch) {
        const sets: string[] = []
        const values: unknown[] = []

        if ('status' in patch) {
            sets.push('status = ?')
            values.push(patch.status)
        }
        if ('rejectionReason' in patch) {
            sets.push('rejectionReason = ?')
            values.push(patch.rejectionReason ?? null)
        }
        if ('serverReceiptId' in patch) {
            sets.push('serverReceiptId = ?')
            values.push(patch.serverReceiptId ?? null)
        }
        if ('attempts' in patch) {
            sets.push('attempts = ?')
            values.push(patch.attempts)
        }
        if ('nextAttemptAt' in patch) {
            sets.push('nextAttemptAt = ?')
            values.push(
                patch.nextAttemptAt === null || patch.nextAttemptAt === undefined ? null : String(patch.nextAttemptAt)
            )
        }
        if (sets.length === 0) {
            return
        }

        values.push(id)
        await db.exec(`UPDATE _receipt_uploads SET ${sets.join(', ')} WHERE id = ?`, values)
        tableInvalidationBus.publish('_receipt_uploads')
    },

    async remove(id) {
        await db.exec('DELETE FROM _receipt_uploads WHERE id = ?', [id])
        tableInvalidationBus.publish('_receipt_uploads')
    },
})

export const createReceiptUploadQueue = (
    store: ReceiptUploadStore = createMemoryReceiptUploadStore()
): ReceiptUploadQueue => {
    const enqueue = async (input: EnqueueUploadInput): Promise<ReceiptUploadEntry> => {
        const entry: ReceiptUploadEntry = {
            id: crypto.randomUUID(),
            localBlobId: input.localBlobId,
            transactionId: input.transactionId,
            filename: input.filename,
            mimeType: input.mimeType,
            status: 'pending',
            rejectionReason: null,
            serverReceiptId: null,
            attempts: 0,
            createdAt: new Date().toISOString(),
            nextAttemptAt: null,
        }
        await store.insert(entry)
        return entry
    }

    const listPending = async (): Promise<ReceiptUploadEntry[]> =>
        (await store.list()).filter((entry) => entry.status === 'pending' || entry.status === 'uploading')

    const listForTransaction = async (transactionId: string): Promise<ReceiptUploadEntry[]> =>
        (await store.list()).filter((entry) => entry.transactionId === transactionId)

    const flush = async (uploadFn: (entry: ReceiptUploadEntry) => Promise<UploadOutcome>): Promise<void> => {
        if (!isOnline()) {
            return
        }

        const now = Date.now()
        const ready = (await store.list()).filter(
            (entry) => entry.status === 'pending' && (entry.nextAttemptAt === null || entry.nextAttemptAt <= now)
        )

        for (const entry of ready) {
            await store.update(entry.id, { status: 'uploading' })
            const outcome = await uploadFn(entry)

            if (outcome.status === 'uploaded') {
                await store.update(entry.id, {
                    status: 'uploaded',
                    serverReceiptId: outcome.receiptId,
                    rejectionReason: null,
                })
                continue
            }

            if (outcome.status === 'rejected') {
                await store.update(entry.id, { status: 'rejected', rejectionReason: outcome.reason })
                continue
            }

            const attempts = entry.attempts + 1
            await store.update(entry.id, {
                status: 'pending',
                attempts,
                nextAttemptAt: Date.now() + computeBackoffDelay(attempts),
                // Persist a receipt id created before a mid-flow network failure (see
                // `uploadReceiptEntryToServer`) so the next attempt resumes at the attach
                // step instead of re-uploading and orphaning a duplicate receipt.
                ...(outcome.receiptId ? { serverReceiptId: outcome.receiptId } : {}),
            })
        }
    }

    const remove = async (id: string): Promise<void> => {
        await store.remove(id)
    }

    return { enqueue, listPending, listForTransaction, flush, remove }
}

/**
 * The real `uploadFn`: multipart POST to `POST /receipts`, then attach to
 * the transaction. Any HTTP response at all - including the virus-scan
 * rejection (400, `ERROR_MESSAGES.RECEIPT.VIRUS_DETECTED`) and the
 * fail-closed "scan service unavailable" response (503,
 * `VIRUS_SCAN_FAILED`) from `receiptController.uploadReceipt` - is a server
 * verdict and maps to `rejected` (terminal, surfaced to the user via
 * `rejectionReason`). Only a genuine network error (no response reached the
 * client at all - see `offline/reachability.ts`'s `isNetworkError`) is
 * `retry`.
 *
 * If `entry.serverReceiptId` is already set, a prior attempt already created
 * the receipt but failed (with a network error) before the attach call
 * completed - skip re-uploading and resume at the attach step, otherwise a
 * retry after that specific failure mode would create a second, orphaned
 * receipt on the server every time.
 */
export const uploadReceiptEntryToServer = async (entry: ReceiptUploadEntry, blob: Blob): Promise<UploadOutcome> => {
    let receiptId = entry.serverReceiptId ?? undefined

    try {
        if (!receiptId) {
            const formData = new FormData()
            formData.append('receipt', blob, entry.filename)
            const response = await axiosInstance.post<ApiResponse<Receipt>>(API_PATHS.RECEIPTS.UPLOAD, formData)
            receiptId = unwrapApiData(response)._id
        }
    } catch (error) {
        if (isNetworkError(error)) {
            return { status: 'retry', error: getApiErrorMessage(error, 'Network error') }
        }
        return { status: 'rejected', reason: getApiErrorMessage(error, 'Receipt upload was rejected by the server') }
    }

    try {
        await axiosInstance.post(API_PATHS.TRANSACTIONS.ATTACH_RECEIPT(entry.transactionId), { receiptId })
        return { status: 'uploaded', receiptId }
    } catch (error) {
        if (isNetworkError(error)) {
            return { status: 'retry', error: getApiErrorMessage(error, 'Network error'), receiptId }
        }
        return { status: 'rejected', reason: getApiErrorMessage(error, 'Receipt could not be attached to the transaction') }
    }
}

/**
 * App-level glue mirroring `sync/syncEngine.ts`'s `flushOutbox()`: builds the
 * real queue against the local DB, reads each ready entry's cached blob
 * bytes, and drains via `uploadReceiptEntryToServer`. If the cached blob was
 * itself evicted (should not happen in practice - eviction protects
 * in-flight uploads, see `db/receiptBlobCache.ts` - but the local DB could
 * have been reset independently), the entry is marked `rejected` rather than
 * retried forever against data that no longer exists.
 */
export const flushReceiptUploads = async (db: LocalDb): Promise<void> => {
    const queue = createReceiptUploadQueue(createSqliteReceiptUploadStore(db))
    await queue.flush(async (entry) => {
        const cached = await getReceiptBlob(db, entry.localBlobId)
        if (!cached) {
            return { status: 'rejected', reason: 'Receipt file is no longer cached locally' }
        }
        const blob = new Blob([new Uint8Array(cached.data)], { type: cached.mimeType })
        return uploadReceiptEntryToServer(entry, blob)
    })
}
