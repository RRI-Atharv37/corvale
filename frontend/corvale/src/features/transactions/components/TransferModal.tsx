import React from 'react'
import Modal from '@ui/Modal'
import FormField, { TextAreaField } from '@ui/forms/FormField'
import AccountPicker from '@features/accounts/components/AccountPicker'
import type { Account } from '@features/accounts/types'
import type { TransferFormData } from '../types'

interface TransferModalProps {
    open: boolean
    onClose: () => void
    onSubmit: (e: React.FormEvent) => void
    transferForm: TransferFormData
    setTransferForm: React.Dispatch<React.SetStateAction<TransferFormData>>
    submitting: boolean
    accounts?: Account[]
}

const TransferModal = ({
    open,
    onClose,
    onSubmit,
    transferForm,
    setTransferForm,
    submitting,
    accounts,
}: TransferModalProps) => {
    return (
        <Modal open={open} onClose={onClose} size="lg" title="Transfer between accounts">
            <form onSubmit={onSubmit} className="space-y-4">
                <FormField
                    label="Title"
                    value={transferForm.title}
                    onChange={(v) => setTransferForm((f) => ({ ...f, title: v }))}
                    placeholder="Move to savings, pay credit card, etc."
                    required
                    disabled={submitting}
                />
                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        label="Amount"
                        type="number"
                        value={transferForm.amount}
                        onChange={(v) => setTransferForm((f) => ({ ...f, amount: v }))}
                        placeholder="0.00"
                        required
                        disabled={submitting}
                        min="0"
                        step="0.01"
                    />
                    <FormField
                        label="Date"
                        type="date"
                        value={transferForm.date}
                        onChange={(v) => setTransferForm((f) => ({ ...f, date: v }))}
                        required
                        disabled={submitting}
                    />
                </div>
                <AccountPicker
                    value={transferForm.fromAccountId}
                    onChange={(fromAccountId) =>
                        setTransferForm((f) => ({ ...f, fromAccountId }))
                    }
                    accountsData={accounts}
                    label="From account"
                    required
                    disabled={submitting}
                />
                <AccountPicker
                    value={transferForm.toAccountId}
                    onChange={(toAccountId) => setTransferForm((f) => ({ ...f, toAccountId }))}
                    accountsData={accounts}
                    label="To account"
                    required
                    disabled={submitting}
                />
                <TextAreaField
                    label="Notes"
                    value={transferForm.description}
                    onChange={(v) => setTransferForm((f) => ({ ...f, description: v }))}
                    placeholder="Optional notes"
                    disabled={submitting}
                />
                <div className="flex gap-3 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-border text-fg-secondary hover:border-border transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={submitting}
                        className="flex-1 px-4 py-2 btn-accent disabled:opacity-50"
                    >
                        {submitting ? 'Transferring...' : 'Transfer'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}

export default TransferModal
