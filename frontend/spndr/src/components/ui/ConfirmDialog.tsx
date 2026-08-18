import React from 'react'
import Modal from './Modal'

interface ConfirmDialogProps {
    open: boolean
    onClose: () => void
    onConfirm: () => void
    title: string
    message: string
    confirmLabel?: string
    loading?: boolean
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    open,
    onClose,
    onConfirm,
    title,
    message,
    confirmLabel = 'Delete',
    loading = false,
}) => (
    <Modal open={open} onClose={onClose} title={title} size="sm">
        <p className="text-sm text-fg-muted mb-6">{message}</p>
        <div className="flex gap-3">
            <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-border text-fg-secondary hover:border-border transition-colors disabled:opacity-50"
            >
                Cancel
            </button>
            <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-destructive text-on-accent hover:bg-destructive/90 transition-colors disabled:opacity-50"
            >
                {loading ? 'Deleting...' : confirmLabel}
            </button>
        </div>
    </Modal>
)

export default ConfirmDialog
