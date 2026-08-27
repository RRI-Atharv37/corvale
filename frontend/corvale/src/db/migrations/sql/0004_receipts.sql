-- Sprint 13.10: local receipt blob cache (LRU) + queued receipt upload.
--
-- `_blobs` was scaffolded in 0001_init.sql (id/entity/recordId/mimeType/
-- sizeBytes/data/createdAt) but had no reader anywhere in the codebase until
-- this sprint. It's a reasonable fit for caching receipt file bytes locally
-- (see db/receiptBlobCache.ts) except it's missing the `lastAccessedAt`
-- column LRU eviction needs, so it's added here via ALTER TABLE rather than
-- standing up a brand-new table.
--
-- `entity` is always 'receipt' for rows this sprint writes. `recordId` holds
-- the transaction id the receipt belongs to (see receiptBlobCache.ts).
ALTER TABLE _blobs ADD COLUMN lastAccessedAt TEXT;

-- Backfill existing rows (none expected pre-13.10 since nothing wrote to
-- `_blobs` before now, but keep the invariant that lastAccessedAt is never
-- NULL for a row that predates this migration) so eviction ordering is well
-- defined immediately.
UPDATE _blobs SET lastAccessedAt = createdAt WHERE lastAccessedAt IS NULL;

CREATE INDEX IF NOT EXISTS idx_blobs_lastAccessedAt ON _blobs (entity, lastAccessedAt);

-- Queued receipt uploads. Deliberately NOT the JSON-op `_outbox` table (see
-- sync/outbox.ts) - receipts are binary multipart uploads to
-- backend/controllers/receiptController.ts's uploadReceipt, and Receipt is
-- intentionally excluded from backend/services/syncService.ts's
-- SYNC_ENTITIES (receipt metadata never flows through /sync/push). This is
-- a small, parallel, purpose-built queue instead - see
-- sync/receiptUploadQueue.ts.
--
-- status: 'pending' -> 'uploading' -> 'uploaded' | 'rejected', or
-- 'uploading' -> 'pending' again on a transient (network) failure, with
-- backoff via nextAttemptAt. 'rejected' is terminal (server-adjudicated -
-- e.g. virus scan rejection or fail-closed scan-unavailable response - never
-- retried); rejectionReason carries the user-visible reason.
CREATE TABLE IF NOT EXISTS _receipt_uploads (
  id TEXT PRIMARY KEY,
  localBlobId TEXT NOT NULL,
  transactionId TEXT NOT NULL,
  filename TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  rejectionReason TEXT,
  serverReceiptId TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  nextAttemptAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_receipt_uploads_status ON _receipt_uploads (status, createdAt);
CREATE INDEX IF NOT EXISTS idx_receipt_uploads_transaction ON _receipt_uploads (transactionId);
CREATE INDEX IF NOT EXISTS idx_receipt_uploads_blob ON _receipt_uploads (localBlobId);
