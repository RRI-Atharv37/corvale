/**
 * Query-option flag to bypass the soft-delete filter, mirroring RLS_BYPASS in
 * rowLevelSecurity.ts. Pass `{ [SOFT_DELETE_BYPASS]: true }` via `.setOptions()`
 * to see tombstoned (deletedAt != null) documents.
 */
export const SOFT_DELETE_BYPASS = 'softDeleteBypass'

/**
 * Retention floor for soft-deleted (tombstoned) records, in days. Must exceed
 * the maximum realistic offline window so a device that reconnects after being
 * offline still finds the tombstone during /sync/pull rather than seeing the
 * record simply vanish with no explanation.
 *
 * SEC-47: enforced by a partial TTL index on `deletedAt` (see softDeletePlugin),
 * not only by the `purge:tombstones` CLI. Lives here - the leaf constants file -
 * so both the plugin and `purgeTombstones.ts` can import it without a cycle.
 */
export const TOMBSTONE_RETENTION_DAYS = 90

export const TOMBSTONE_RETENTION_SECONDS = TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60
