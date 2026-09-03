import { isTauriRuntime } from '@lib/isTauri'
import { saveFileNative } from './nativeBackup'

export type ExportFormat = 'csv' | 'json' | 'pdf'

export const EXPORT_FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
    { value: 'csv', label: 'CSV' },
    { value: 'json', label: 'JSON' },
    { value: 'pdf', label: 'PDF' },
]

export const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
    csv: 'text/csv',
    json: 'application/json',
    pdf: 'application/pdf',
}

export const TRANSACTION_EXPORT_TYPE_OPTIONS = [
    { value: 'both', label: 'Income & expenses' },
    { value: 'income', label: 'Income only' },
    { value: 'expense', label: 'Expenses only' },
] as const

export type TransactionExportType = (typeof TRANSACTION_EXPORT_TYPE_OPTIONS)[number]['value']

export const ensureExportBlob = (data: unknown, format: ExportFormat): Blob => {
    if (data instanceof Blob) {
        return data
    }

    return new Blob([data as BlobPart], { type: EXPORT_MIME_TYPES[format] })
}

export const downloadExportBlob = (blob: Blob, filename: string): void => {
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    window.URL.revokeObjectURL(url)
}

export const buildExportFilename = (baseName: string, format: ExportFormat): string => {
    return `${baseName}.${format}`
}

/**
 * Save an exported blob to disk. In the Tauri desktop shell the `<a download>` blob-URL trick
 * above is inert, so this routes through a native "Save As" dialog (BUG-26); on web it triggers
 * the normal browser download. Resolves `false` only when the user cancels the desktop dialog.
 */
export const saveExportedFile = async (blob: Blob, filename: string): Promise<boolean> => {
    if (isTauriRuntime()) {
        return saveFileNative(filename, blob)
    }
    downloadExportBlob(blob, filename)
    return true
}
