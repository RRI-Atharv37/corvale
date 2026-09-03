import React, { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { IoCloudDownloadOutline, IoCloudUploadOutline } from 'react-icons/io5'

import { useWorkspace } from '@/app/providers/useWorkspace'
import type { BackupEntityCounts, BackupRestorePreview } from '@lib/types/api'
import { getApiErrorMessage } from '@lib/apiError'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import {
    BACKUP_ACCEPT,
    commitBackupRestore,
    exportBackup,
    previewBackupRestore,
    validateBackupFile,
} from '../backupApi'
import { LOCAL_BACKUP_ACCEPT, useLocalBackup, validateLocalBackupFile } from '../hooks/useLocalBackup'

const countLabels: { key: keyof BackupEntityCounts; label: string }[] = [
    { key: 'accounts', label: 'Accounts' },
    { key: 'categories', label: 'Categories' },
    { key: 'tags', label: 'Tags' },
    { key: 'budgets', label: 'Budgets' },
    { key: 'savingsGoals', label: 'Savings goals' },
    { key: 'savingsGoalContributions', label: 'Goal contributions' },
    { key: 'recurringRules', label: 'Recurring rules' },
    { key: 'categorizationRules', label: 'Categorization rules' },
    { key: 'transactionTemplates', label: 'Templates' },
    { key: 'transactions', label: 'Transactions' },
    { key: 'receipts', label: 'Receipts' },
]

const CountGrid: React.FC<{ counts: BackupEntityCounts }> = ({ counts }) => (
    <dl className="grid grid-cols-2 gap-2 text-sm">
        {countLabels.map(({ key, label }) =>
            counts[key] > 0 ? (
                <div key={key} className="flex justify-between gap-2 rounded-lg bg-bg-secondary px-3 py-2">
                    <dt className="text-text-muted">{label}</dt>
                    <dd className="font-medium text-text-primary">{counts[key]}</dd>
                </div>
            ) : null
        )}
    </dl>
)

const BackupRestoreSettings: React.FC = () => {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const { activeWorkspaceId, canEdit, isPersonal, activeWorkspace } = useWorkspace()
    const localFirst = isLocalFirstEnabled()
    const localBackup = useLocalBackup()

    const [exporting, setExporting] = useState<'json' | 'zip' | null>(null)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [preview, setPreview] = useState<BackupRestorePreview | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const [restoring, setRestoring] = useState(false)

    const scopeLabel = isPersonal
        ? 'personal data'
        : `workspace “${activeWorkspace?.name ?? 'Shared'}”`

    const handleExport = async (format: 'json' | 'zip') => {
        setExporting(format)
        try {
            if (localFirst) {
                // ZIP (receipts) has no local equivalent - see `domain/backup.ts`'s header comment;
                // the ZIP button is hidden in local-first mode so this branch is JSON-only in practice.
                await localBackup.exportLocal()
            } else {
                await exportBackup(format, activeWorkspaceId)
            }
            toast.success(format === 'zip' ? 'ZIP backup downloaded' : 'JSON backup downloaded')
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to export backup'))
        } finally {
            setExporting(null)
        }
    }

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0] ?? null
        setSelectedFile(file)
        setPreview(null)

        if (!file) {
            return
        }

        const validationError = localFirst ? validateLocalBackupFile(file) : validateBackupFile(file)
        if (validationError) {
            toast.error(validationError)
            event.target.value = ''
            setSelectedFile(null)
        }
    }

    const handlePreview = async () => {
        if (!selectedFile) {
            toast.error('Choose a backup file first')
            return
        }

        setPreviewLoading(true)
        try {
            const result = localFirst
                ? await localBackup.previewLocalRestoreFile(selectedFile)
                : await previewBackupRestore(selectedFile, activeWorkspaceId)
            setPreview(result)
            if (!result.valid) {
                toast.error(result.errors[0] ?? 'Backup could not be restored')
            }
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to preview backup'))
            setPreview(null)
        } finally {
            setPreviewLoading(false)
        }
    }

    const handleRestore = async () => {
        if (!selectedFile || !preview?.valid) {
            return
        }

        const confirmed = window.confirm(
            `Restore ${scopeLabel}? New records will be created with fresh ids; existing data is not deleted.`
        )
        if (!confirmed) {
            return
        }

        setRestoring(true)
        try {
            const result = localFirst
                ? await localBackup.commitLocalRestoreFile(selectedFile)
                : await commitBackupRestore(selectedFile, activeWorkspaceId)
            const totalCreated = Object.values(result.created).reduce((sum, count) => sum + count, 0)
            toast.success(`Restore complete — ${totalCreated} records created`)
            setSelectedFile(null)
            setPreview(null)
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to restore backup'))
        } finally {
            setRestoring(false)
        }
    }

    return (
        <div>
            <p className="section-label mb-3">Backup &amp; restore</p>
            <p className="text-sm text-text-muted mb-4">
                {localFirst
                    ? `Export all ${scopeLabel} as JSON from the local store, or restore a JSON backup — works fully offline. Restore creates new records with remapped ids; it does not overwrite existing data.`
                    : `Export all ${scopeLabel} as JSON, or ZIP with receipt files. Restore creates new records with remapped ids — it does not overwrite existing data.`}
            </p>
            {localFirst && (
                <p className="mb-4 text-xs text-text-quiet">
                    ZIP export/restore with receipt files requires an online connection.
                </p>
            )}

            {!canEdit && (
                <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                    View-only in this workspace. Switch to personal data or an editor workspace to export
                    or restore.
                </p>
            )}

            <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        disabled={!canEdit || exporting !== null}
                        onClick={() => void handleExport('json')}
                        className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-primary hover:border-accent/40 hover:bg-accent-subtle disabled:opacity-50"
                    >
                        <IoCloudDownloadOutline size={16} />
                        {exporting === 'json' ? 'Exporting…' : 'Export JSON'}
                    </button>
                    {!localFirst && (
                        <button
                            type="button"
                            disabled={!canEdit || exporting !== null}
                            onClick={() => void handleExport('zip')}
                            className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-primary hover:border-accent/40 hover:bg-accent-subtle disabled:opacity-50"
                        >
                            <IoCloudDownloadOutline size={16} />
                            {exporting === 'zip' ? 'Exporting…' : 'Export ZIP (+ receipts)'}
                        </button>
                    )}
                </div>

                <div className="rounded-lg border border-border-subtle p-4 space-y-3">
                    <p className="text-sm font-medium text-text-primary">Restore from backup</p>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={localFirst ? LOCAL_BACKUP_ACCEPT : BACKUP_ACCEPT}
                        disabled={!canEdit || restoring}
                        onChange={handleFileChange}
                        className="block w-full text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-accent-subtle file:px-3 file:py-2 file:text-sm file:font-medium file:text-accent hover:file:bg-accent/20"
                    />
                    {selectedFile && (
                        <p className="text-xs text-text-quiet truncate">{selectedFile.name}</p>
                    )}

                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            disabled={!canEdit || !selectedFile || previewLoading || restoring}
                            onClick={() => void handlePreview()}
                            className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-primary hover:border-accent/40 disabled:opacity-50"
                        >
                            <IoCloudUploadOutline size={16} />
                            {previewLoading ? 'Previewing…' : 'Preview restore'}
                        </button>
                        <button
                            type="button"
                            disabled={!canEdit || !preview?.valid || restoring}
                            onClick={() => void handleRestore()}
                            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                        >
                            {restoring ? 'Restoring…' : 'Confirm restore'}
                        </button>
                    </div>

                    {preview && (
                        <div className="space-y-3 pt-2 border-t border-border-subtle">
                            {preview.exportedAt && (
                                <p className="text-xs text-text-quiet">
                                    Exported {new Date(preview.exportedAt).toLocaleString()}
                                </p>
                            )}
                            <CountGrid counts={preview.counts} />
                            {preview.warnings.map((warning) => (
                                <p key={warning} className="text-xs text-warning">
                                    {warning}
                                </p>
                            ))}
                            {preview.errors.map((error) => (
                                <p key={error} className="text-xs text-destructive">
                                    {error}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default BackupRestoreSettings
