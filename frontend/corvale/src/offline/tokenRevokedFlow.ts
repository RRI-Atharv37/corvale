/**
 * Sequences the "session was revoked while offline" recovery: if there are unsynced local
 * writes, offer the user a chance to export them before they're gone, then wipe. The wipe
 * must never run before the export offer has been resolved, so a slow/interactive export
 * dialog isn't racing the data it's trying to save.
 */

/** Dispatched by `axiosInstance` on a confirmed `TOKEN_REVOKED` response; `UserContext` listens for it. */
export const TOKEN_REVOKED_EVENT = 'corvale:token-revoked'

export interface HandleTokenRevokedOptions {
    hasUnsyncedChanges: boolean
    onExportOffer: () => Promise<unknown> | unknown
    wipe: () => Promise<unknown>
}

export const handleTokenRevoked = async ({
    hasUnsyncedChanges,
    onExportOffer,
    wipe,
}: HandleTokenRevokedOptions): Promise<void> => {
    if (hasUnsyncedChanges) {
        await onExportOffer()
    }
    await wipe()
}
