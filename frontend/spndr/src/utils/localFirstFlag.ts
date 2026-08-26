/**
 * Sprint 13.6: gates the local-first sync engine (outbox flush, pull loop, sync status UI) so the
 * existing online-only path keeps working unmodified while pages are migrated one at a time (13.9+).
 */
export const isLocalFirstEnabled = (): boolean => import.meta.env.VITE_LOCAL_FIRST === 'true'
