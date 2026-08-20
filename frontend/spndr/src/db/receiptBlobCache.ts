import type { LocalDb, LocalDbRow } from './LocalDb'

/**
 * Sprint 13.10: local receipt blob cache with LRU eviction, backed by the
 * `_blobs` table scaffolded in 0001_init.sql (id/entity/recordId/mimeType/
 * sizeBytes/data/createdAt) and extended with `lastAccessedAt` in
 * 0004_receipts.sql. `entity` is always 'receipt' for rows this module
 * writes - `_blobs` is shared scaffolding; other blob kinds could reuse the
 * same table under a different `entity` value in the future.
 *
 * `recordId` holds the transaction id the receipt belongs to, so the cache
 * can be queried per-transaction without a join. Every read via
 * `getReceiptBlob` touches `lastAccessedAt`, and every write via
 * `putReceiptBlob` evicts least-recently-accessed blobs until the total
 * cached size is back under the cap - except a blob with an in-flight
 * upload (a `pending`/`uploading` row in `_receipt_uploads` referencing it),
 * which is never evicted: losing those bytes before the upload completes
 * would silently drop a receipt the user believes is queued. See
 * `sync/receiptUploadQueue.ts`.
 */

export const DEFAULT_RECEIPT_CACHE_MAX_BYTES = 50 * 1024 * 1024 // 50 MB

const ENTITY = 'receipt'

export interface CachedReceiptBlob {
  id: string
  recordId: string
  mimeType: string
  sizeBytes: number
  data: Uint8Array
  createdAt: string
  lastAccessedAt: string
}

interface BlobRow extends LocalDbRow {
  id: string
  recordId: string
  mimeType: string | null
  sizeBytes: number
  data: Uint8Array | ArrayBuffer | number[] | null
  createdAt: string
  lastAccessedAt: string | null
}

const toUint8Array = async (data: Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> => {
  if (data instanceof Uint8Array) return data
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer())
  }
  return new Uint8Array(data as ArrayBuffer)
}

const toBytes = (data: BlobRow['data']): Uint8Array => {
  if (!data) return new Uint8Array(0)
  if (data instanceof Uint8Array) return data
  if (Array.isArray(data)) return new Uint8Array(data)
  return new Uint8Array(data as ArrayBuffer)
}

const rowToBlob = (row: BlobRow): CachedReceiptBlob => ({
  id: row.id,
  recordId: row.recordId,
  mimeType: row.mimeType ?? 'application/octet-stream',
  sizeBytes: row.sizeBytes,
  data: toBytes(row.data),
  createdAt: row.createdAt,
  lastAccessedAt: row.lastAccessedAt ?? row.createdAt,
})

export interface PutReceiptBlobInput {
  /** Omit to generate a fresh id. */
  id?: string
  recordId: string
  mimeType: string
  data: Uint8Array | ArrayBuffer | Blob
  /** Override for tests; defaults to `DEFAULT_RECEIPT_CACHE_MAX_BYTES`. */
  maxTotalBytes?: number
}

/** Inserts (or replaces) a cached receipt blob, then evicts LRU-first until the cache is back under the cap. */
export const putReceiptBlob = async (db: LocalDb, input: PutReceiptBlobInput): Promise<CachedReceiptBlob> => {
  const bytes = await toUint8Array(input.data)
  const id = input.id ?? crypto.randomUUID()
  const now = new Date().toISOString()

  await db.exec(
    `INSERT INTO _blobs (id, entity, recordId, mimeType, sizeBytes, data, createdAt, lastAccessedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       recordId = excluded.recordId,
       mimeType = excluded.mimeType,
       sizeBytes = excluded.sizeBytes,
       data = excluded.data,
       lastAccessedAt = excluded.lastAccessedAt`,
    [id, ENTITY, input.recordId, input.mimeType, bytes.byteLength, bytes, now, now]
  )

  await evictReceiptBlobsToFit(db, input.maxTotalBytes ?? DEFAULT_RECEIPT_CACHE_MAX_BYTES)

  return { id, recordId: input.recordId, mimeType: input.mimeType, sizeBytes: bytes.byteLength, data: bytes, createdAt: now, lastAccessedAt: now }
}

/** Reads a cached blob by id and refreshes `lastAccessedAt` (LRU touch). Returns null if evicted or never cached. */
export const getReceiptBlob = async (db: LocalDb, id: string): Promise<CachedReceiptBlob | null> => {
  const rows = await db.select<BlobRow>('SELECT * FROM _blobs WHERE id = ? AND entity = ?', [id, ENTITY])
  if (rows.length === 0) return null

  const now = new Date().toISOString()
  await db.exec('UPDATE _blobs SET lastAccessedAt = ? WHERE id = ?', [now, id])
  return rowToBlob({ ...rows[0], lastAccessedAt: now })
}

/** Removes a cached blob without touching recency of anything else. */
export const deleteReceiptBlob = async (db: LocalDb, id: string): Promise<void> => {
  await db.exec('DELETE FROM _blobs WHERE id = ? AND entity = ?', [id, ENTITY])
}

export const listReceiptBlobsForRecord = async (db: LocalDb, recordId: string): Promise<CachedReceiptBlob[]> => {
  const rows = await db.select<BlobRow>(
    'SELECT * FROM _blobs WHERE entity = ? AND recordId = ? ORDER BY createdAt ASC',
    [ENTITY, recordId]
  )
  return rows.map(rowToBlob)
}

export const getReceiptCacheUsageBytes = async (db: LocalDb): Promise<number> => {
  const rows = await db.select<{ total: number | null }>(
    'SELECT SUM(sizeBytes) as total FROM _blobs WHERE entity = ?',
    [ENTITY]
  )
  return rows[0]?.total ?? 0
}

/**
 * Evicts least-recently-accessed receipt blobs until total cached bytes is
 * `<= maxTotalBytes`, skipping any blob referenced by an unresolved
 * (`pending`/`uploading`) row in `_receipt_uploads`. Returns the evicted
 * blob ids. If every over-cap blob is protected by an in-flight upload, the
 * cache stays over cap until those uploads resolve - correctness (never
 * losing an unsent receipt) wins over strictly enforcing the size cap.
 */
export const evictReceiptBlobsToFit = async (
  db: LocalDb,
  maxTotalBytes: number = DEFAULT_RECEIPT_CACHE_MAX_BYTES
): Promise<string[]> => {
  let total = await getReceiptCacheUsageBytes(db)
  if (total <= maxTotalBytes) return []

  const candidates = await db.select<{ id: string; sizeBytes: number }>(
    `SELECT id, sizeBytes FROM _blobs
     WHERE entity = ?
       AND id NOT IN (SELECT localBlobId FROM _receipt_uploads WHERE status IN ('pending', 'uploading'))
     ORDER BY lastAccessedAt ASC, createdAt ASC`,
    [ENTITY]
  )

  const evicted: string[] = []
  for (const candidate of candidates) {
    if (total <= maxTotalBytes) break
    await db.exec('DELETE FROM _blobs WHERE id = ?', [candidate.id])
    total -= candidate.sizeBytes
    evicted.push(candidate.id)
  }

  return evicted
}
