import { getLocalDb } from '../db/localDbInstance'
import { createSqliteOutboxStore } from '../sync/sqliteOutboxStore'
import { ensureExportBlob, saveExportedFile } from '../desktop/downloadExport'

/**
 * Downloads every not-yet-synced outbox op as a JSON file, for the "offer an export before
 * wiping" step of the `TOKEN_REVOKED` recovery flow (`tokenRevokedFlow.ts`). Best-effort: if
 * the local DB can't be read, resolves without throwing so the wipe that follows still runs.
 * Uses the shared `saveExportedFile` so the desktop shell gets a real "Save As" dialog (BUG-26).
 */
export const exportUnsyncedOps = async (): Promise<boolean> => {
    try {
        const db = await getLocalDb()
        const ops = await createSqliteOutboxStore(db).list()
        if (ops.length === 0) {
            return false
        }

        const blob = ensureExportBlob(JSON.stringify(ops, null, 2), 'json')
        const stamp = new Date().toISOString().replace(/:/g, '-')
        return await saveExportedFile(blob, `corvale-unsynced-changes-${stamp}.json`)
    } catch {
        return false
    }
}
