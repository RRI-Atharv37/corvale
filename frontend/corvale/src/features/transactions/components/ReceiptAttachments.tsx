import React, { useCallback, useEffect, useRef, useState } from 'react'
import { IoClose, IoCloudUploadOutline, IoDocument, IoImage, IoWarning } from 'react-icons/io5'
import toast from 'react-hot-toast'

import type { Receipt } from '@lib/types/api'
import type { LocalDb } from '@platform/db/LocalDb'
import { getLocalDb } from '@platform/db/localDbInstance'
import { deleteReceiptBlob, getReceiptBlob, putReceiptBlob } from '@platform/db/receiptBlobCache'
import {
    createReceiptUploadQueue,
    createSqliteReceiptUploadStore,
    flushReceiptUploads,
    type ReceiptUploadEntry,
} from '@platform/sync/receiptUploadQueue'
import { tableInvalidationBus } from '@lib/tableInvalidationBus'
import {
    attachReceiptToTransaction,
    deleteReceipt,
    detachReceiptFromTransaction,
    fetchReceiptBlob,
    isImageReceipt,
    isPdfReceipt,
    RECEIPT_INPUT_ACCEPT,
    uploadReceipt,
    validateReceiptFile,
} from '../receiptApi'
import { getApiErrorMessage } from '@lib/apiError'
import { useOnlineStatus } from '@platform/offline/useOnlineStatus'
import { isTauriRuntime } from '@lib/isTauri'
import ReceiptViewerModal from './ReceiptViewerModal'

interface ReceiptAttachmentsProps {
    transactionId?: string | null
    receipts: Receipt[]
    onChange: (receipts: Receipt[]) => void
    pendingFiles?: File[]
    onPendingFilesChange?: (files: File[]) => void
    disabled?: boolean
}

export const ReceiptPreviewTile = ({
    receipt,
    onDetach,
    onDelete,
    disabled,
}: {
    receipt: Receipt
    onDetach?: () => void
    onDelete?: () => void
    disabled?: boolean
}) => {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [loading, setLoading] = useState(isImageReceipt(receipt.mimeType))
    const [viewerUrl, setViewerUrl] = useState<string | null>(null)

    useEffect(() => {
        if (!isImageReceipt(receipt.mimeType)) {
            return undefined
        }

        let active = true
        let objectUrl: string | null = null

        const loadPreview = async () => {
            try {
                const blob = await fetchReceiptBlob(receipt._id)
                if (!active) return
                objectUrl = URL.createObjectURL(blob)
                setPreviewUrl(objectUrl)
            } catch {
                if (active) toast.error('Failed to load receipt preview')
            } finally {
                if (active) setLoading(false)
            }
        }

        void loadPreview()

        return () => {
            active = false
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [receipt._id, receipt.mimeType])

    // BUG-25: `window.open` is a silent no-op inside the Tauri webview, so on the desktop runtime
    // the receipt opens in an in-app modal instead. The web build keeps opening a new tab.
    useEffect(() => {
        if (!viewerUrl) return undefined
        return () => URL.revokeObjectURL(viewerUrl)
    }, [viewerUrl])

    const openReceipt = async () => {
        try {
            const blob = await fetchReceiptBlob(receipt._id)
            const url = URL.createObjectURL(blob)
            if (isTauriRuntime()) {
                setViewerUrl(url)
            } else {
                window.open(url, '_blank', 'noopener,noreferrer')
                window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
            }
        } catch {
            toast.error('Failed to open receipt')
        }
    }

    return (
        <div className="relative rounded-lg border border-border bg-surface/50 p-2 w-[120px]">
            <ReceiptViewerModal
                open={Boolean(viewerUrl)}
                url={viewerUrl}
                mimeType={receipt.mimeType}
                filename={receipt.originalFilename}
                onClose={() => setViewerUrl(null)}
            />
            <button
                type="button"
                onClick={() => void openReceipt()}
                className="block w-full text-left"
                title={receipt.originalFilename}
            >
                <div className="h-20 flex items-center justify-center rounded bg-base/60 overflow-hidden">
                    {isImageReceipt(receipt.mimeType) ? (
                        loading ? (
                            <IoImage className="text-fg-quiet" size={24} />
                        ) : previewUrl ? (
                            <img
                                src={previewUrl}
                                alt={receipt.originalFilename}
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <IoImage className="text-fg-quiet" size={24} />
                        )
                    ) : isPdfReceipt(receipt.mimeType) ? (
                        <IoDocument className="text-expense" size={28} />
                    ) : (
                        <IoDocument className="text-fg-muted" size={28} />
                    )}
                </div>
                <p className="mt-1 text-[10px] text-fg-muted truncate">{receipt.originalFilename}</p>
            </button>
            {!disabled && (onDetach || onDelete) && (
                <button
                    type="button"
                    onClick={onDetach ?? onDelete}
                    className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-surface-hover border border-border text-fg-muted hover:text-expense"
                    aria-label="Remove receipt"
                >
                    <IoClose size={12} />
                </button>
            )}
        </div>
    )
}

/**
 * Sprint 13.10: renders a receipt that's been cached locally and queued for
 * upload (see `sync/receiptUploadQueue.ts`) but hasn't reached the server
 * yet - `pending`/`uploading` shows a queued badge with a locally-rendered
 * preview (from the cached blob bytes, `db/receiptBlobCache.ts`); `rejected`
 * shows the server's verdict (virus scan or scan-service-unavailable) with a
 * dismiss action instead of a silent drop.
 */
const QueuedReceiptTile = ({
    entry,
    db,
    onDismiss,
}: {
    entry: ReceiptUploadEntry
    db: LocalDb | null
    onDismiss: () => void
}) => {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)

    useEffect(() => {
        if (!db || !entry.mimeType.startsWith('image/')) return undefined

        let active = true
        let objectUrl: string | null = null

        void getReceiptBlob(db, entry.localBlobId).then((cached) => {
            if (!active || !cached) return
            objectUrl = URL.createObjectURL(new Blob([new Uint8Array(cached.data)], { type: cached.mimeType }))
            setPreviewUrl(objectUrl)
        })

        return () => {
            active = false
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [db, entry.localBlobId, entry.mimeType])

    const isRejected = entry.status === 'rejected'

    return (
        <div
            className={`relative rounded-lg border p-2 w-[120px] ${
                isRejected ? 'border-expense/60 bg-expense/5' : 'border-dashed border-border bg-surface/30'
            }`}
        >
            <div className="h-20 flex items-center justify-center rounded bg-base/40 overflow-hidden">
                {previewUrl ? (
                    <img src={previewUrl} alt={entry.filename} className="h-full w-full object-cover opacity-80" />
                ) : isRejected ? (
                    <IoWarning className="text-expense" size={24} />
                ) : (
                    <IoCloudUploadOutline className="text-accent/70" size={24} />
                )}
            </div>
            <p className="mt-1 text-[10px] text-fg-muted truncate" title={entry.filename}>
                {entry.filename}
            </p>
            <p className={`text-[9px] ${isRejected ? 'text-expense' : 'text-fg-quiet'}`} title={entry.rejectionReason ?? undefined}>
                {isRejected ? entry.rejectionReason ?? 'Upload rejected' : entry.status === 'uploading' ? 'Uploading...' : 'Queued offline'}
            </p>
            <button
                type="button"
                onClick={onDismiss}
                className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-surface-hover border border-border text-fg-muted hover:text-expense"
                aria-label={isRejected ? 'Dismiss rejected receipt' : 'Cancel queued receipt'}
            >
                <IoClose size={12} />
            </button>
        </div>
    )
}

const ReceiptAttachments = ({
    transactionId,
    receipts,
    onChange,
    pendingFiles = [],
    onPendingFilesChange,
    disabled = false,
}: ReceiptAttachmentsProps) => {
    const inputRef = useRef<HTMLInputElement>(null)
    const [uploading, setUploading] = useState(false)
    const [db, setDb] = useState<LocalDb | null>(null)
    const [queuedUploads, setQueuedUploads] = useState<ReceiptUploadEntry[]>([])
    const online = useOnlineStatus()
    const uploadDisabled = disabled || !online
    const rejectionToastedRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        let active = true
        void getLocalDb().then((instance) => {
            if (active) setDb(instance)
        })
        return () => {
            active = false
        }
    }, [])

    const refreshQueuedUploads = useCallback(async () => {
        if (!db || !transactionId) {
            setQueuedUploads([])
            return
        }
        const queue = createReceiptUploadQueue(createSqliteReceiptUploadStore(db))
        setQueuedUploads(await queue.listForTransaction(transactionId))
    }, [db, transactionId])

    // Keeps the queued-tile list in sync with enqueue/flush state changes (this component's own
    // writes and, in principle, any other flush trigger elsewhere in the app).
    useEffect(() => {
        void refreshQueuedUploads()
        return tableInvalidationBus.subscribe('_receipt_uploads', () => void refreshQueuedUploads())
    }, [refreshQueuedUploads])

    // A queued upload that finished successfully (server confirmed the receipt + attach) is
    // promoted into `receipts` via the parent's `onChange`, then cleared from the queue so it
    // doesn't linger as a duplicate tile. A rejected upload is surfaced once via toast (never
    // silently dropped - the tile itself stays until the user dismisses it).
    useEffect(() => {
        if (!db) return

        const uploaded = queuedUploads.filter(
            (entry) =>
                entry.status === 'uploaded' &&
                entry.serverReceiptId &&
                !receipts.some((receipt) => receipt._id === entry.serverReceiptId)
        )
        if (uploaded.length > 0) {
            void (async () => {
                const queue = createReceiptUploadQueue(createSqliteReceiptUploadStore(db))
                const newReceipts: Receipt[] = uploaded.map((entry) => ({
                    _id: entry.serverReceiptId as string,
                    originalFilename: entry.filename,
                    mimeType: entry.mimeType,
                    size: 0,
                }))
                onChange([...receipts, ...newReceipts])
                for (const entry of uploaded) {
                    await queue.remove(entry.id)
                }
                toast.success(uploaded.length === 1 ? 'Queued receipt uploaded' : 'Queued receipts uploaded')
            })()
        }

        for (const entry of queuedUploads) {
            if (entry.status === 'rejected' && !rejectionToastedRef.current.has(entry.id)) {
                rejectionToastedRef.current.add(entry.id)
                toast.error(entry.rejectionReason ?? 'A queued receipt was rejected by the server')
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queuedUploads, db])

    // Foreground flush-on-reconnect (Sprint 13.10 v1 - see ReceiptAttachments.tsx header note in
    // the sprint report for the Background Sync scope decision): attempts a flush whenever this
    // component is mounted online, and again the moment connectivity returns. `flushReceiptUploads`
    // itself is a no-op while offline.
    useEffect(() => {
        if (!db || !online) return
        void flushReceiptUploads(db)
    }, [db, online])

    const queueFilesOffline = async (files: File[]) => {
        if (!transactionId) return
        const localDb = db ?? (await getLocalDb())
        if (!db) setDb(localDb)

        for (const file of files) {
            const bytes = new Uint8Array(await file.arrayBuffer())
            await localDb.transaction(async (tx) => {
                const cached = await putReceiptBlob(tx, {
                    recordId: transactionId,
                    mimeType: file.type,
                    data: bytes,
                })
                const queue = createReceiptUploadQueue(createSqliteReceiptUploadStore(tx))
                await queue.enqueue({
                    localBlobId: cached.id,
                    transactionId,
                    filename: file.name,
                    mimeType: file.type,
                })
            })
        }

        toast.success(
            files.length === 1
                ? 'Receipt saved - it will upload once you are back online'
                : 'Receipts saved - they will upload once you are back online'
        )
        await refreshQueuedUploads()
    }

    const handleFilesSelected = async (files: FileList | null) => {
        if (!files?.length || disabled) return

        const selected = Array.from(files)
        for (const file of selected) {
            const validationError = validateReceiptFile(file)
            if (validationError) {
                toast.error(validationError)
                return
            }
        }

        if (!transactionId) {
            onPendingFilesChange?.([...pendingFiles, ...selected])
            if (inputRef.current) inputRef.current.value = ''
            return
        }

        if (!online) {
            try {
                await queueFilesOffline(selected)
            } catch (err) {
                toast.error(getApiErrorMessage(err, 'Failed to save receipt for offline upload'))
            } finally {
                if (inputRef.current) inputRef.current.value = ''
            }
            return
        }

        setUploading(true)
        try {
            const uploaded: Receipt[] = []
            for (const file of selected) {
                const receipt = await uploadReceipt(file)
                await attachReceiptToTransaction(transactionId, receipt._id)
                uploaded.push(receipt)
            }
            onChange([...receipts, ...uploaded])
            toast.success(uploaded.length === 1 ? 'Receipt attached' : 'Receipts attached')
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to upload receipt'))
        } finally {
            setUploading(false)
            if (inputRef.current) inputRef.current.value = ''
        }
    }

    const handleDetach = async (receiptId: string) => {
        if (!transactionId || uploadDisabled) return

        setUploading(true)
        try {
            await detachReceiptFromTransaction(transactionId, receiptId)
            onChange(receipts.filter((receipt) => receipt._id !== receiptId))
            toast.success('Receipt detached')
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to detach receipt'))
        } finally {
            setUploading(false)
        }
    }

    const handleDeletePending = (index: number) => {
        onPendingFilesChange?.(pendingFiles.filter((_, i) => i !== index))
    }

    const handleDeleteOrphan = async (receiptId: string) => {
        if (uploadDisabled) return
        setUploading(true)
        try {
            await deleteReceipt(receiptId)
            onChange(receipts.filter((receipt) => receipt._id !== receiptId))
            toast.success('Receipt deleted')
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to delete receipt'))
        } finally {
            setUploading(false)
        }
    }

    const handleDismissQueued = async (entry: ReceiptUploadEntry) => {
        if (!db) return
        const queue = createReceiptUploadQueue(createSqliteReceiptUploadStore(db))
        await queue.remove(entry.id)
        await deleteReceiptBlob(db, entry.localBlobId)
        await refreshQueuedUploads()
    }

    const visibleQueuedUploads = queuedUploads.filter((entry) => entry.status !== 'uploaded')

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] text-fg-secondary">Receipts</p>
                {!disabled && (
                    <>
                        <input
                            ref={inputRef}
                            type="file"
                            accept={RECEIPT_INPUT_ACCEPT}
                            multiple
                            className="hidden"
                            onChange={(e) => void handleFilesSelected(e.target.files)}
                        />
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            disabled={uploading}
                            className="text-xs text-accent hover:text-accent disabled:opacity-50"
                        >
                            {uploading ? 'Uploading...' : '+ Add receipt'}
                        </button>
                    </>
                )}
            </div>

            {!disabled && !online && (
                <p className="text-xs text-warning">
                    Offline - new receipts will be saved locally and uploaded once you're back online.
                </p>
            )}

            {(receipts.length > 0 || pendingFiles.length > 0 || visibleQueuedUploads.length > 0) && (
                <div className="flex flex-wrap gap-2">
                    {receipts.map((receipt) => (
                        <ReceiptPreviewTile
                            key={receipt._id}
                            receipt={receipt}
                            disabled={uploadDisabled || uploading}
                            onDetach={
                                transactionId
                                    ? () => void handleDetach(receipt._id)
                                    : () => void handleDeleteOrphan(receipt._id)
                            }
                        />
                    ))}
                    {visibleQueuedUploads.map((entry) => (
                        <QueuedReceiptTile
                            key={entry.id}
                            entry={entry}
                            db={db}
                            onDismiss={() => void handleDismissQueued(entry)}
                        />
                    ))}
                    {pendingFiles.map((file, index) => (
                        <div
                            key={`${file.name}-${index}`}
                            className="relative rounded-lg border border-dashed border-border bg-surface/30 p-2 w-[120px]"
                        >
                            <div className="h-20 flex items-center justify-center rounded bg-base/40">
                                {file.type.startsWith('image/') ? (
                                    <IoImage className="text-accent/70" size={24} />
                                ) : (
                                    <IoDocument className="text-expense/80" size={24} />
                                )}
                            </div>
                            <p className="mt-1 text-[10px] text-fg-muted truncate">{file.name}</p>
                            {!disabled && (
                                <button
                                    type="button"
                                    onClick={() => handleDeletePending(index)}
                                    className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-surface-hover border border-border text-fg-muted hover:text-expense"
                                    aria-label="Remove pending receipt"
                                >
                                    <IoClose size={12} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {!disabled &&
                online &&
                receipts.length === 0 &&
                pendingFiles.length === 0 &&
                visibleQueuedUploads.length === 0 && (
                    <p className="text-xs text-fg-muted">Attach JPEG, PNG, WebP, or PDF receipts (max 5 MB).</p>
                )}
        </div>
    )
}

export default ReceiptAttachments
