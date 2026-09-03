import { getSyncStatus, syncNow } from '../sync/syncEngine'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'

/**
 * SEC-46: a deliberate sign-out wipes the local store (`wipeLocalData`), so any local write that
 * has not yet reached the server is lost with it. The cookie policy says "signing out removes the
 * local copy" - true, but the user should get to choose whether to push those changes up first
 * rather than have them silently discarded.
 *
 * This module is the headless half; `components/sync/SignOutDialog.tsx` is the UI. Mirrors
 * `offline/tokenRevokedFlow.ts`, which does the equivalent for an involuntary revoke.
 */

/** Count of local writes not yet accepted by the server. Always 0 when local-first is off. */
export const countUnsyncedChanges = async (): Promise<number> => {
    if (!isLocalFirstEnabled()) {
        return 0
    }
    try {
        const status = await getSyncStatus()
        return status.pendingCount
    } catch {
        // Local DB unavailable - nothing we can push, so nothing to warn about.
        return 0
    }
}

/**
 * Flush the outbox, then report how many ops still could not sync (0 = safe to sign out with no
 * data loss). A rejected/offline op stays counted so the caller can offer discard-or-cancel
 * rather than claiming success.
 */
export const syncBeforeSignOut = async (): Promise<number> => {
    try {
        await syncNow()
    } catch {
        // fall through to the recount
    }
    return countUnsyncedChanges()
}
