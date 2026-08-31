import { isLocalFirstEnabled } from './localFirstFlag'
import { exportBackup } from './backupApi'
import { saveExportedFile } from './downloadExport'
import { getLocalDb } from '../db/localDbInstance'
import { exportLocalBackup } from '../domain/backup'

/**
 * SEC-48: export the signed-in user's personal data with no active-workspace context.
 *
 * `LegalGate` sits above `WorkspaceProvider` in the tree, so it cannot use `useWorkspace` /
 * `useLocalBackup`. The consent gate is about the individual's own rights anyway, so a personal
 * (workspaceId: null) export is the right scope. Mirrors `BackupRestoreSettings`' JSON export
 * one-for-one otherwise.
 */
export const exportPersonalBackup = async (): Promise<void> => {
    if (isLocalFirstEnabled()) {
        const db = await getLocalDb()
        const payload = await exportLocalBackup(db, { workspaceId: null })
        const filename = `corvale-backup-personal-${payload.exportedAt.slice(0, 10)}.json`
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        await saveExportedFile(blob, filename)
        return
    }
    await exportBackup('json')
}
