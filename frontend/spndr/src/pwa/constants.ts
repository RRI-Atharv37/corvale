/** Shared between `src/sw.ts` (its own Rollup build) and `src/pwa/backgroundSync.ts` (the main app
 * bundle) so the Background Sync tag and postMessage type can't drift between the two builds. */
export const OUTBOX_SYNC_TAG = 'spndr-outbox-sync'
export const FLUSH_OUTBOX_MESSAGE = 'SPNDR_FLUSH_OUTBOX'
