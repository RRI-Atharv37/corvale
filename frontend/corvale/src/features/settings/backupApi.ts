import axiosInstance from '@lib/axiosInstance'
import { API_PATHS, BASE_URL } from '@lib/apiPaths'
import type {
    ApiResponse,
    BackupRestorePreview,
    BackupRestoreResult,
} from '@lib/types/api'
import { unwrapApiData } from '@lib/apiHelpers'
import { saveExportedFile } from '@platform/desktop/downloadExport'

export type BackupExportFormat = 'json' | 'zip'

export const BACKUP_ACCEPT = '.json,.zip,application/json,application/zip'
export const BACKUP_MAX_BYTES = 50 * 1024 * 1024

export const validateBackupFile = (file: File): string | null => {
    const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
    if (!['.json', '.zip'].includes(extension)) {
        return 'Backup file must be a JSON or ZIP export'
    }
    if (file.size > BACKUP_MAX_BYTES) {
        return 'Backup file exceeds the 50 MB size limit'
    }
    return null
}

export const exportBackup = async (
    format: BackupExportFormat,
    workspaceId?: string | null
): Promise<void> => {
    const params: Record<string, string> = { format }
    if (workspaceId) {
        params.workspaceId = workspaceId
    }

    const blobData = await axiosInstance.get<Blob>(API_PATHS.BACKUP.EXPORT, {
        params,
        responseType: 'blob',
    })

    const filename = `corvale-backup.${format === 'zip' ? 'zip' : 'json'}`
    await saveExportedFile(blobData, filename)
}

export const previewBackupRestore = async (
    file: File,
    workspaceId?: string | null
): Promise<BackupRestorePreview> => {
    const validationError = validateBackupFile(file)
    if (validationError) {
        throw new Error(validationError)
    }

    const formData = new FormData()
    formData.append('file', file)
    if (workspaceId) {
        formData.append('workspaceId', workspaceId)
    }

    const response = await axiosInstance.post<ApiResponse<BackupRestorePreview>>(
        API_PATHS.BACKUP.PREVIEW,
        formData,
        {
            headers: { 'Content-Type': 'multipart/form-data' },
        }
    )
    return unwrapApiData(response)
}

export const commitBackupRestore = async (
    file: File,
    workspaceId?: string | null
): Promise<BackupRestoreResult> => {
    const validationError = validateBackupFile(file)
    if (validationError) {
        throw new Error(validationError)
    }

    const formData = new FormData()
    formData.append('file', file)
    if (workspaceId) {
        formData.append('workspaceId', workspaceId)
    }

    const response = await axiosInstance.post<ApiResponse<BackupRestoreResult>>(
        API_PATHS.BACKUP.RESTORE,
        formData,
        {
            headers: { 'Content-Type': 'multipart/form-data' },
        }
    )
    return unwrapApiData(response)
}

/** Base URL helper for manual downloads (unused by components; kept for parity with other APIs). */
export const backupExportUrl = (format: BackupExportFormat, workspaceId?: string | null): string => {
    const params = new URLSearchParams({ format })
    if (workspaceId) {
        params.set('workspaceId', workspaceId)
    }
    return `${BASE_URL}${API_PATHS.BACKUP.EXPORT}?${params.toString()}`
}
