import React from 'react'
import Modal from '../ui/Modal'

interface SignOutDialogProps {
    open: boolean
    /** Unsynced local changes at the moment the dialog opened (or after a failed sync attempt). */
    unsyncedCount: number
    syncing: boolean
    onSyncAndSignOut: () => void
    onDiscardAndSignOut: () => void
    onCancel: () => void
}

/**
 * SEC-46: shown when the user signs out with local changes still in the outbox. Signing out
 * wipes the local store, so this makes the choice explicit - push the changes up first, or
 * knowingly drop them - instead of discarding them silently.
 */
const SignOutDialog: React.FC<SignOutDialogProps> = ({
    open,
    unsyncedCount,
    syncing,
    onSyncAndSignOut,
    onDiscardAndSignOut,
    onCancel,
}) => (
    <Modal open={open} onClose={onCancel} title="Sign out with unsynced changes?" size="sm">
        <p className="text-sm text-fg-muted mb-2">
            {unsyncedCount === 1
                ? 'One change on this device has not synced to your account yet.'
                : `${unsyncedCount} changes on this device have not synced to your account yet.`}
        </p>
        <p className="text-sm text-fg-muted mb-6">
            Signing out clears the local copy of your data, so anything not synced will be lost.
        </p>
        <div className="flex flex-col gap-2">
            <button
                type="button"
                onClick={onSyncAndSignOut}
                disabled={syncing}
                className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
                {syncing ? 'Syncing…' : 'Sync, then sign out'}
            </button>
            <button
                type="button"
                onClick={onDiscardAndSignOut}
                disabled={syncing}
                className="w-full rounded-lg border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
                Discard changes and sign out
            </button>
            <button
                type="button"
                onClick={onCancel}
                disabled={syncing}
                className="w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg-secondary hover:border-border disabled:opacity-50"
            >
                Cancel
            </button>
        </div>
    </Modal>
)

export default SignOutDialog
