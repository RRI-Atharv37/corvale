/**
 * Query-option flag to bypass the soft-delete filter, mirroring RLS_BYPASS in
 * rowLevelSecurity.ts. Pass `{ [SOFT_DELETE_BYPASS]: true }` via `.setOptions()`
 * to see tombstoned (deletedAt != null) documents.
 */
export const SOFT_DELETE_BYPASS = 'softDeleteBypass'
