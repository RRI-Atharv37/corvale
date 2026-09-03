import { isValidTimezone } from '@shared/timezone'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { unwrapApiData } from '@lib/apiHelpers'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import { hasPinConfigured, isLocalDbUnlocked } from './offline/pinStorage'
import type { ApiResponse, User } from '@lib/types/api'

/**
 * V5 - timezone auto-detection.
 *
 * The ~400-entry timezone dropdown is gone; the stored `User.timezone` is kept in step with the
 * device automatically instead. Two moments feed it:
 *
 *  - **signup** - `detectTimezone()` is sent in the register payload (see `Signup.tsx`;
 *    `registerUser` validates and stores it, falling back to `'UTC'`).
 *  - **once per session** - `syncTimezoneOncePerSession()` runs from `DashboardLayout` after the
 *    session is established, PATCHing `/auth/user` only when the detected zone differs from what's
 *    stored. It **fails silently** - a PATCH failure on a travel day is noise, not something to
 *    toast about.
 */

const SESSION_FLAG_KEY = 'corvale:timezone-synced'

/** The IANA zone the browser is currently in, or `null` if it can't be read / isn't valid. */
export const detectTimezone = (): string | null => {
    try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
        return zone && isValidTimezone(zone) ? zone : null
    } catch {
        return null
    }
}

const readSessionFlag = (): boolean => {
    try {
        return sessionStorage.getItem(SESSION_FLAG_KEY) !== null
    } catch {
        return false
    }
}

const writeSessionFlag = (): void => {
    try {
        sessionStorage.setItem(SESSION_FLAG_KEY, '1')
    } catch {
        // Private-mode / storage-disabled: the module-level `settled` guard still prevents a
        // repeat within this page load; we just lose the across-reload suppression.
    }
}

/** True when a configured PIN means the local DB is sitting locked right now. */
const isLocalDbLocked = async (): Promise<boolean> => {
    if (!isLocalFirstEnabled() || !hasPinConfigured()) return false
    try {
        return !(await isLocalDbUnlocked())
    } catch {
        return true
    }
}

// Guards a second run within one page load - both the React StrictMode double-effect and any
// re-render of the calling component. `settled` latches only once the work has genuinely finished
// (or been suppressed by the session flag); a transient skip (no user yet, offline, DB locked)
// leaves it clear so a later call can retry.
let settled = false
let inFlight: Promise<void> | null = null

/**
 * Detects the device timezone and, at most once per browser session, pushes it to the server when
 * it no longer matches `user.timezone`. No-ops when: already done this session, no authenticated
 * user yet, offline, or the local DB is PIN-locked. Never throws, never surfaces UI.
 *
 * @param user      the current authenticated user (or `null` before the session loads)
 * @param applyUser called with the updated `User` when a PATCH actually changes the stored zone
 */
export const syncTimezoneOncePerSession = async (
    user: User | null,
    applyUser: (user: User) => void,
): Promise<void> => {
    if (settled) return
    if (inFlight) return inFlight

    if (!user) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    if (readSessionFlag()) {
        settled = true
        return
    }

    inFlight = (async () => {
        try {
            if (await isLocalDbLocked()) return

            const detected = detectTimezone()
            if (detected && detected !== user.timezone) {
                const response = await axiosInstance.patch<ApiResponse<User>>(API_PATHS.AUTH.UPDATE_USER, {
                    timezone: detected,
                })
                applyUser(unwrapApiData(response))
            }

            writeSessionFlag()
            settled = true
        } catch {
            // Fail silently (V5). Leave `settled` clear so a later mount can retry.
        } finally {
            inFlight = null
        }
    })()

    return inFlight
}

/** Test-only: clears the module-level guards between cases. */
export const __resetTimezoneSyncForTests = (): void => {
    settled = false
    inFlight = null
}
