import { getLocalDb } from '../db/localDbInstance'
import { createSqliteOutboxStore } from '../sync/sqliteOutboxStore'
import { downloadExportBlob, ensureExportBlob } from '../utils/downloadExport'

/**
 * Downloads every not-yet-synced outbox op as a JSON file, for the "offer an export before
 * wiping" step of the `TOKEN_REVOKED` recovery flow (`tokenRevokedFlow.ts`). Best-effort: if
 * the local DB can't be read, resolves without throwing so the wipe that follows still runs.
 */
export const exportUnsyncedOps = async (): Promise<boolean> => {
    try {
        const db = await getLocalDb()
        const ops = await createSqliteOutboxStore(db).list()
        if (ops.length === 0) {
            return false
        }

        const blob = ensureExportBlob(JSON.stringify(ops, null, 2), 'json')
        downloadExportBlob(blob, `spndr-unsynced-changes-${new Date().toISOString()}.json`)
        return true
    } catch {
        return false
    }
}
