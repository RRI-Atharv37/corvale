import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import { exportBackup, fetchBackupExtras } from './backupApi'
import { saveExportedFile } from '@platform/desktop/downloadExport'
import { getLocalDb } from '@platform/db/localDbInstance'
import { exportLocalBackupWithExtras } from '@domain/backup'

/**
 * SEC-48: export the signed-in user's personal data with no active-workspace context.
 *
 * `LegalGate` sits above `WorkspaceProvider` in the tree, so it cannot use `useWorkspace` /
 * `useLocalBackup`. The consent gate is about the individual's own rights anyway, so a personal
 * (workspaceId: null) export is the right scope. Mirrors `BackupRestoreSettings`' JSON export
 * one-for-one otherwise.
 */
export const exportPersonalBackup = async (): Promise<{ omittedSections: string[] }> => {
    if (isLocalFirstEnabled()) {
        const db = await getLocalDb()
        const payload = await exportLocalBackupWithExtras(db, { workspaceId: null }, fetchBackupExtras)
        const filename = `corvale-backup-personal-${payload.exportedAt.slice(0, 10)}.json`
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        await saveExportedFile(blob, filename)
        return { omittedSections: payload.omittedSections ?? [] }
    }
    await exportBackup('json')
    return { omittedSections: [] }
}
