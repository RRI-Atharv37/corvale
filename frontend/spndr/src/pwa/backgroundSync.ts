import { FLUSH_OUTBOX_MESSAGE, OUTBOX_SYNC_TAG } from './constants'

interface SyncManager {
    register: (tag: string) => Promise<void>
}

/**
 * Asks the browser to wake the service worker (even with every tab closed, on browsers that
 * support Background Sync) once connectivity is available, so a queued outbox op still has a
 * chance to flush. Safe to call unconditionally - including while online, since registration
 * just makes the `sync` event fire promptly - and a no-op on unsupported browsers (Safari,
 * Firefox), which fall back entirely to `startForegroundSyncScheduler` below.
 */
export const registerBackgroundSync = async (): Promise<void> => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    try {
        const registration = await navigator.serviceWorker.ready
        const sync = (registration as ServiceWorkerRegistration & { sync?: SyncManager }).sync
        if (!sync) return
        await sync.register(OUTBOX_SYNC_TAG)
    } catch {
        // Best-effort - the foreground scheduler below is the fallback.
    }
}

const FOREGROUND_INTERVAL_MS = 45_000

/**
 * Bridges the service worker's Background Sync wake-up (see `src/sw.ts`'s `sync` handler, which
 * can only message an open client - it has no direct access to the SQLite-backed outbox) to a
 * real flush, and independently retries on a timer while the tab is foregrounded. The timer is
 * the actual fallback for browsers with no Background Sync support at all, and it also covers the
 * gap where `sync` fires with zero open clients to message.
 */
export const startBackgroundSyncBridge = (flush: () => Promise<void>): (() => void) => {
    if (typeof navigator === 'undefined') return () => {}

    const handleMessage = (event: MessageEvent) => {
        if ((event.data as { type?: string } | undefined)?.type === FLUSH_OUTBOX_MESSAGE) {
            void flush()
        }
    }
    navigator.serviceWorker?.addEventListener('message', handleMessage)

    const interval = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
        void flush()
    }, FOREGROUND_INTERVAL_MS)

    return () => {
        navigator.serviceWorker?.removeEventListener('message', handleMessage)
        clearInterval(interval)
    }
}
