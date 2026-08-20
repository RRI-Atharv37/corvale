import { useCallback } from 'react'
import { getLocalDb } from '../../../db/localDbInstance'
import {
    LOCAL_BACKUP_MAX_JSON_BYTES,
    exportLocalBackup,
    parseLocalBackupPayload,
    previewLocalRestore,
    restoreLocalBackup,
    type SpndrBackupPayload,
} from '../../../domain/backup'
import { downloadExportBlob } from '../../../utils/downloadExport'
import { useUser } from '../../../hooks/useUser'
import { useWorkspace } from '../../../hooks/useWorkspace'
import type { BackupRestorePreview, BackupRestoreResult } from '../../../types/api'

export const LOCAL_BACKUP_ACCEPT = '.json,application/json'

/**
 * Local-store equivalent of `utils/backupApi.ts`'s `validateBackupFile` - JSON only. There is no
 * client-side ZIP/archiver dependency and no local receipt store to bundle (see `domain/backup.ts`'s
 * header comment), so a `.zip` selected here can only be a server export with receipts attached;
 * that combination has to go through the server restore endpoint instead.
 */
export const validateLocalBackupFile = (file: File): string | null => {
    const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
    if (extension !== '.json') {
        return 'Local restore only supports JSON backups - ZIP (with receipts) requires an online connection'
    }
    if (file.size > LOCAL_BACKUP_MAX_JSON_BYTES) {
        return 'Backup file exceeds the 10 MB size limit'
    }
    return null
}

const readFileAsJson = async (file: File): Promise<unknown> => {
    const text = await file.text()
    try {
        return JSON.parse(text)
    } catch {
        throw new Error('Backup file is not a valid spndr backup')
    }
}

export interface UseLocalBackupResult {
    exportLocal: () => Promise<void>
    previewLocalRestoreFile: (file: File) => Promise<BackupRestorePreview>
    commitLocalRestoreFile: (file: File) => Promise<BackupRestoreResult>
}

/**
 * Settings-page data layer for the local (offline) branch of backup/restore (Sprint 13.10). Mirrors
 * `utils/backupApi.ts`'s REST functions one-for-one so `BackupRestoreSettings.tsx` can branch on
 * `isLocalFirstEnabled()` the same way `pages/Dashboard/hooks/use*Data.ts` branch their data hooks.
 */
export const useLocalBackup = (): UseLocalBackupResult => {
    const { user } = useUser()
    const { activeWorkspaceId } = useWorkspace()

    const exportLocal = useCallback(async () => {
        const db = await getLocalDb()
        const payload = await exportLocalBackup(db, { workspaceId: activeWorkspaceId ?? null })
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        const scopeLabel = payload.scope.workspaceId ? 'workspace' : 'personal'
        downloadExportBlob(blob, `spndr-backup-${scopeLabel}-${payload.exportedAt.slice(0, 10)}.json`)
    }, [activeWorkspaceId])

    const parseFile = useCallback(async (file: File): Promise<SpndrBackupPayload> => {
        const validationError = validateLocalBackupFile(file)
        if (validationError) {
            throw new Error(validationError)
        }
        const raw = await readFileAsJson(file)
        return parseLocalBackupPayload(raw)
    }, [])

    const previewLocalRestoreFile = useCallback(
        async (file: File): Promise<BackupRestorePreview> => {
            const db = await getLocalDb()
            const backup = await parseFile(file)
            return previewLocalRestore(db, backup, activeWorkspaceId ?? null)
        },
        [activeWorkspaceId, parseFile]
    )

    const commitLocalRestoreFile = useCallback(
        async (file: File): Promise<BackupRestoreResult> => {
            if (!user) {
                throw new Error('Not authenticated')
            }
            const db = await getLocalDb()
            const backup = await parseFile(file)
            return restoreLocalBackup(db, backup, {
                userId: user._id,
                targetWorkspaceId: activeWorkspaceId ?? null,
            })
        },
        [activeWorkspaceId, parseFile, user]
    )

    return { exportLocal, previewLocalRestoreFile, commitLocalRestoreFile }
}
