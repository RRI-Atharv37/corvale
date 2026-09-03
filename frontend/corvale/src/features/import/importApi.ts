import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import type { ApiResponse } from '@lib/types/api'
import type { ColumnMapping, ImportCommitResponse, ImportDelimiter, ImportDuplicateAction, ImportParseResponse, ImportPreviewResponse, ImportRowError, ParsedImportRow } from '@features/import/types'
import { unwrapApiData } from '@lib/apiHelpers'

export const IMPORT_ACCEPT = '.csv,.ofx,.qfx,.qif,text/csv,application/vnd.ms-excel'
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024

export const validateImportFile = (file: File): string | null => {
    const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
    const allowedExtensions = ['.csv', '.ofx', '.qfx', '.qif']
    if (!allowedExtensions.includes(extension)) {
        return 'Import file must be a CSV, OFX/QFX, or QIF file'
    }
    if (file.size > IMPORT_MAX_BYTES) {
        return 'Import file exceeds the 2 MB size limit'
    }
    return null
}

export const parseImportFile = async (
    file: File,
    delimiter?: ImportDelimiter
): Promise<ImportParseResponse> => {
    const validationError = validateImportFile(file)
    if (validationError) {
        throw new Error(validationError)
    }

    const formData = new FormData()
    formData.append('file', file)
    if (delimiter) {
        formData.append('delimiter', delimiter)
    }

    const response = await axiosInstance.post<ApiResponse<ImportParseResponse>>(
        API_PATHS.IMPORTS.PARSE,
        formData
    )
    return unwrapApiData(response)
}

export interface ImportPreviewPayload {
    accountId: string
    defaultCategoryId: string
    workspaceId?: string | null
    headers?: string[]
    rows?: string[][]
    mapping?: ColumnMapping
    parsedRows?: ParsedImportRow[]
    parsedRowErrors?: ImportRowError[]
    rowDecisions?: Record<number, ImportDuplicateAction>
}

export const previewImport = async (
    payload: ImportPreviewPayload
): Promise<ImportPreviewResponse> => {
    const response = await axiosInstance.post<ApiResponse<ImportPreviewResponse>>(
        API_PATHS.IMPORTS.PREVIEW,
        payload
    )
    return unwrapApiData(response)
}

export const commitImport = async (
    payload: ImportPreviewPayload
): Promise<ImportCommitResponse> => {
    const response = await axiosInstance.post<ApiResponse<ImportCommitResponse>>(
        API_PATHS.IMPORTS.COMMIT,
        payload
    )
    return unwrapApiData(response)
}
