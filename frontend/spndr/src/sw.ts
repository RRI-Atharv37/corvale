import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'
import { OUTBOX_SYNC_TAG, LEGACY_OUTBOX_SYNC_TAG, FLUSH_OUTBOX_MESSAGE } from './pwa/constants'

/**
 * Custom service worker (vite-plugin-pwa `injectManifest` strategy) rather than `generateSW`,
 * so we can add our own Background Sync handler (Sprint 13.8) alongside Workbox's precache +
 * SPA navigation fallback. Typed loosely against `self` rather than pulling the `webworker` lib
 * into the project's tsconfig, mirroring `db/worker/sqliteWorker.ts`'s reasoning: `webworker`
 * conflicts with the `DOM` lib the main app needs, and the handful of globals used here don't
 * need the full ServiceWorkerGlobalScope typing.
 */
interface SwClient {
    postMessage: (message: unknown) => void
}
interface SwEvent {
    data?: { type?: string }
    tag?: string
    waitUntil: (promise: Promise<unknown>) => void
}
const ctx = self as unknown as {
    skipWaiting: () => void
    addEventListener: (type: string, listener: (event: SwEvent) => void) => void
    clients: { matchAll: (opts?: { type?: string; includeUncontrolled?: boolean }) => Promise<SwClient[]> }
}

// `workbox-build`'s injectManifest step finds this injection point by a literal source-text search
// for `self.__WB_MANIFEST` - it must be written exactly like this (not through the `ctx` cast above)
// or the build fails with "unable to find a place to inject the manifest".
declare global {
    interface Window {
        __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0]
    }
}
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
clientsClaim()

// SPA fallback: any navigation request not found in the precache (e.g. a deep link opened
// offline) resolves to the cached app shell so client-side routing can take over.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//],
}))

// Update flow: `virtual:pwa-register/react` (see src/pwa/UpdatePrompt.tsx) posts this message
// when the user confirms the "update available" prompt.
ctx.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        ctx.skipWaiting()
    }
})

// Background Sync: registered from src/pwa/backgroundSync.ts whenever an outbox op is enqueued
// while offline. This service worker cannot reach the SQLite-backed outbox directly (it lives in
// a dedicated Worker per Sprint 13.4), so on `sync` we just wake any open client and let it run
// the real flush - see src/pwa/backgroundSync.ts for the foreground-scheduler fallback that
// covers browsers without Background Sync support (Safari/Firefox) and the "no client open" gap.
ctx.addEventListener('sync', (event) => {
    // V7.3d: a Background Sync tag registered before the Corvale rename (LEGACY_OUTBOX_SYNC_TAG)
    // still fires here after the new SW activates — accept it alongside the current tag for one
    // release so queued pre-rename offline writes flush. See src/pwa/constants.ts.
    if (event.tag !== OUTBOX_SYNC_TAG && event.tag !== LEGACY_OUTBOX_SYNC_TAG) return
    event.waitUntil(
        ctx.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) client.postMessage({ type: FLUSH_OUTBOX_MESSAGE })
        })
    )
})
