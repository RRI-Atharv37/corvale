import React, { useEffect, useRef, useState } from 'react'
import { IoClose, IoDocument, IoImage } from 'react-icons/io5'
import toast from 'react-hot-toast'

import type { Receipt } from '../../types/api'
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
} from '../../utils/receiptApi'
import { getApiErrorMessage } from '../../utils/apiError'

interface ReceiptAttachmentsProps {
    transactionId?: string | null
    receipts: Receipt[]
    onChange: (receipts: Receipt[]) => void
    pendingFiles?: File[]
    onPendingFilesChange?: (files: File[]) => void
    disabled?: boolean
}

const ReceiptPreviewTile = ({
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

    const openReceipt = async () => {
        try {
            const blob = await fetchReceiptBlob(receipt._id)
            const url = URL.createObjectURL(blob)
            window.open(url, '_blank', 'noopener,noreferrer')
            window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
        } catch {
            toast.error('Failed to open receipt')
        }
    }

    return (
        <div className="relative rounded-lg border border-slate-700 bg-slate-900/50 p-2 w-[120px]">
            <button
                type="button"
                onClick={() => void openReceipt()}
                className="block w-full text-left"
                title={receipt.originalFilename}
            >
                <div className="h-20 flex items-center justify-center rounded bg-slate-950/60 overflow-hidden">
                    {isImageReceipt(receipt.mimeType) ? (
                        loading ? (
                            <IoImage className="text-slate-600" size={24} />
                        ) : previewUrl ? (
                            <img
                                src={previewUrl}
                                alt={receipt.originalFilename}
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <IoImage className="text-slate-600" size={24} />
                        )
                    ) : isPdfReceipt(receipt.mimeType) ? (
                        <IoDocument className="text-rose-400" size={28} />
                    ) : (
                        <IoDocument className="text-slate-500" size={28} />
                    )}
                </div>
                <p className="mt-1 text-[10px] text-slate-400 truncate">{receipt.originalFilename}</p>
            </button>
            {!disabled && (onDetach || onDelete) && (
                <button
                    type="button"
                    onClick={onDetach ?? onDelete}
                    className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-slate-800 border border-slate-600 text-slate-400 hover:text-rose-400"
                    aria-label="Remove receipt"
                >
                    <IoClose size={12} />
                </button>
            )}
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
        if (!transactionId || disabled) return

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
        if (disabled) return
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

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] text-slate-300">Receipts</p>
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
                            className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
                        >
                            {uploading ? 'Uploading...' : '+ Add receipt'}
                        </button>
                    </>
                )}
            </div>

            {(receipts.length > 0 || pendingFiles.length > 0) && (
                <div className="flex flex-wrap gap-2">
                    {receipts.map((receipt) => (
                        <ReceiptPreviewTile
                            key={receipt._id}
                            receipt={receipt}
                            disabled={disabled || uploading}
                            onDetach={
                                transactionId
                                    ? () => void handleDetach(receipt._id)
                                    : () => void handleDeleteOrphan(receipt._id)
                            }
                        />
                    ))}
                    {pendingFiles.map((file, index) => (
                        <div
                            key={`${file.name}-${index}`}
                            className="relative rounded-lg border border-dashed border-slate-600 bg-slate-900/30 p-2 w-[120px]"
                        >
                            <div className="h-20 flex items-center justify-center rounded bg-slate-950/40">
                                {file.type.startsWith('image/') ? (
                                    <IoImage className="text-cyan-500/70" size={24} />
                                ) : (
                                    <IoDocument className="text-rose-400/80" size={24} />
                                )}
                            </div>
                            <p className="mt-1 text-[10px] text-slate-400 truncate">{file.name}</p>
                            {!disabled && (
                                <button
                                    type="button"
                                    onClick={() => handleDeletePending(index)}
                                    className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-slate-800 border border-slate-600 text-slate-400 hover:text-rose-400"
                                    aria-label="Remove pending receipt"
                                >
                                    <IoClose size={12} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {!disabled && receipts.length === 0 && pendingFiles.length === 0 && (
                <p className="text-xs text-slate-500">Attach JPEG, PNG, WebP, or PDF receipts (max 5 MB).</p>
            )}
        </div>
    )
}

export default ReceiptAttachments
