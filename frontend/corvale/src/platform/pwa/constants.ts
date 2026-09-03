/** Shared between `src/sw.ts` (its own Rollup build) and `src/pwa/backgroundSync.ts` (the main app
 * bundle) so the Background Sync tag and postMessage type can't drift between the two builds. */
export const OUTBOX_SYNC_TAG = 'corvale-outbox-sync'

/**
 * V7.3d rename-compat shim: Background Sync registrations persist across service-worker updates,
 * so a tag registered as `spndr-outbox-sync` before the Corvale rename is still what the browser
 * fires against the new service worker after it activates. `sw.ts`'s `sync` handler accepts this
 * legacy tag alongside `OUTBOX_SYNC_TAG` for one release; without it, every queued offline write
 * from a pre-rename session would never flush. Safe to drop one release after v1.0.0. See
 * ROADMAP's V7 compat matrix.
 */
export const LEGACY_OUTBOX_SYNC_TAG = 'spndr-outbox-sync'

export const FLUSH_OUTBOX_MESSAGE = 'CORVALE_FLUSH_OUTBOX'
