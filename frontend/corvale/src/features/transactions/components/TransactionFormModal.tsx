import React from 'react'
import { IoTrash } from 'react-icons/io5'
import Modal from '@ui/Modal'
import FormField, { TextAreaField } from '@ui/forms/FormField'
import CategoryPicker from '@features/categories/components/CategoryPicker'
import TagPicker from '@features/tags/components/TagPicker'
import AccountPicker from '@features/accounts/components/AccountPicker'
import ReceiptAttachments from './ReceiptAttachments'
import type { CategoriesResponse } from '@features/categories/types'
import type { Account } from '@features/accounts/types'
import type { Tag } from '@features/tags/types'
import type { Receipt } from '@lib/types/api'
import type { SplitLineFormData, TransactionFormData } from '../types'

interface Lookups {
    accounts: Account[]
    categories: CategoriesResponse
    tags: Tag[]
}

interface TransactionFormModalProps {
    open: boolean
    onClose: () => void
    onSubmit: (e: React.FormEvent) => void
    form: TransactionFormData
    setForm: React.Dispatch<React.SetStateAction<TransactionFormData>>
    editingId: string | null
    submitting: boolean
    lookups: Lookups | null
    incomeMasterId?: string
    updateSplitLine: (index: number, patch: Partial<SplitLineFormData>) => void
    addSplitLine: () => void
    removeSplitLine: (index: number) => void
    splitTotal: number
    splitDiff: number
    attachedReceipts: Receipt[]
    onAttachedReceiptsChange: (receipts: Receipt[]) => void
    pendingReceiptFiles: File[]
    onPendingReceiptFilesChange: (files: File[]) => void
    refetchLookups: () => Promise<void>
}

const TransactionFormModal = ({
    open,
    onClose,
    onSubmit,
    form,
    setForm,
    editingId,
    submitting,
    lookups,
    incomeMasterId,
    updateSplitLine,
    addSplitLine,
    removeSplitLine,
    splitTotal,
    splitDiff,
    attachedReceipts,
    onAttachedReceiptsChange,
    pendingReceiptFiles,
    onPendingReceiptFilesChange,
    refetchLookups,
}: TransactionFormModalProps) => {
    return (
        <Modal
            open={open}
            onClose={onClose}
            size="lg"
            title={
                editingId
                    ? 'Edit transaction'
                    : form.type === 'income'
                      ? 'Add income'
                      : 'Add expense'
            }
        >
            <form onSubmit={onSubmit} className="space-y-4">
                {!editingId && (
                    <div>
                        <label className="text-[13px] text-fg-secondary">Type</label>
                        <div className="input-box mb-0 mt-1">
                            <select
                                value={form.type}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        type: e.target.value as 'income' | 'expense',
                                        categoryId: '',
                                    }))
                                }
                                disabled={submitting}
                                className="w-full bg-transparent outline-none text-fg"
                            >
                                <option value="income" className="bg-surface">
                                    Income
                                </option>
                                <option value="expense" className="bg-surface">
                                    Expense
                                </option>
                            </select>
                        </div>
                    </div>
                )}
                <FormField
                    label="Title"
                    value={form.title}
                    onChange={(v) => setForm((f) => ({ ...f, title: v }))}
                    placeholder={form.type === 'income' ? 'Salary, freelance, etc.' : 'Groceries, rent, etc.'}
                    required
                    disabled={submitting}
                />
                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        label="Amount"
                        type="number"
                        value={form.amount}
                        onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
                        placeholder="0.00"
                        required
                        disabled={submitting}
                        min="0"
                        step="0.01"
                    />
                    <FormField
                        label="Date"
                        type="date"
                        value={form.date}
                        onChange={(v) => setForm((f) => ({ ...f, date: v }))}
                        required
                        disabled={submitting}
                    />
                </div>
                <AccountPicker
                    value={form.accountId}
                    onChange={(accountId) => setForm((f) => ({ ...f, accountId }))}
                    accountsData={lookups?.accounts.filter((a) => !a.isArchived)}
                    required
                    disabled={submitting}
                />
                {form.type === 'expense' && !editingId && (
                    <label className="flex items-center gap-2 text-sm text-fg-secondary">
                        <input
                            type="checkbox"
                            checked={form.splitEnabled}
                            onChange={(e) =>
                                setForm((f) => ({
                                    ...f,
                                    splitEnabled: e.target.checked,
                                    categoryId: e.target.checked ? '' : f.categoryId,
                                }))
                            }
                            disabled={submitting}
                            className="rounded border-border bg-surface"
                        />
                        Split across categories
                    </label>
                )}
                {form.splitEnabled && form.type === 'expense' && !editingId ? (
                    <div className="space-y-3 rounded-lg border border-border p-3">
                        <div className="flex items-center justify-between">
                            <p className="text-sm text-fg-secondary">Split lines</p>
                            <button
                                type="button"
                                onClick={addSplitLine}
                                disabled={submitting}
                                className="text-xs text-accent hover:text-accent"
                            >
                                + Add line
                            </button>
                        </div>
                        {form.splits.map((line, index) => (
                            <div key={index} className="grid grid-cols-[1fr_120px_auto] gap-2 items-end">
                                <CategoryPicker
                                    value={line.categoryId}
                                    onChange={(categoryId) => updateSplitLine(index, { categoryId })}
                                    categoriesData={lookups?.categories}
                                    required
                                    disabled={submitting}
                                    label={index === 0 ? 'Category' : undefined}
                                />
                                <FormField
                                    label={index === 0 ? 'Amount' : ' '}
                                    type="number"
                                    value={line.amount}
                                    onChange={(v) => updateSplitLine(index, { amount: v })}
                                    placeholder="0.00"
                                    required
                                    disabled={submitting}
                                    min="0"
                                    step="0.01"
                                />
                                {form.splits.length > 2 && (
                                    <button
                                        type="button"
                                        onClick={() => removeSplitLine(index)}
                                        disabled={submitting}
                                        className="p-2 text-fg-muted hover:text-expense"
                                        aria-label="Remove split line"
                                    >
                                        <IoTrash size={14} />
                                    </button>
                                )}
                            </div>
                        ))}
                        <p
                            className={[
                                'text-xs',
                                Math.abs(splitDiff) < 0.001 ? 'text-fg-muted' : 'text-warning',
                            ].join(' ')}
                        >
                            Split total: {splitTotal.toFixed(2)}
                            {Math.abs(splitDiff) >= 0.001
                                ? ` (${splitDiff > 0 ? 'remaining' : 'over'} ${Math.abs(splitDiff).toFixed(2)})`
                                : ' · matches total'}
                        </p>
                    </div>
                ) : (
                    <CategoryPicker
                        value={form.categoryId}
                        onChange={(categoryId) => setForm((f) => ({ ...f, categoryId }))}
                        masterCategoryId={form.type === 'income' ? incomeMasterId : undefined}
                        categoriesData={lookups?.categories}
                        required
                        disabled={submitting}
                    />
                )}
                {form.type === 'income' ? (
                    <FormField
                        label="Source"
                        value={form.source}
                        onChange={(v) => setForm((f) => ({ ...f, source: v }))}
                        placeholder="Employer or client"
                        disabled={submitting}
                    />
                ) : (
                    <>
                        <FormField
                            label="Payment method"
                            value={form.paymentMethod}
                            onChange={(v) => setForm((f) => ({ ...f, paymentMethod: v }))}
                            placeholder="Card, cash, UPI, etc."
                            disabled={submitting}
                        />
                        <TagPicker
                            value={form.tags}
                            onChange={(tags) => setForm((f) => ({ ...f, tags }))}
                            tagsData={lookups?.tags}
                            onTagsChange={refetchLookups}
                            disabled={submitting}
                        />
                    </>
                )}
                <TextAreaField
                    label="Notes"
                    value={form.description}
                    onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                    placeholder="Optional notes"
                    disabled={submitting}
                />
                {!form.splitEnabled && (
                    <ReceiptAttachments
                        transactionId={editingId}
                        receipts={attachedReceipts}
                        onChange={onAttachedReceiptsChange}
                        pendingFiles={pendingReceiptFiles}
                        onPendingFilesChange={onPendingReceiptFilesChange}
                        disabled={submitting}
                    />
                )}
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
                        className="flex-1 px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors disabled:opacity-50"
                    >
                        {submitting ? 'Saving...' : editingId ? 'Update' : 'Add transaction'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}

export default TransactionFormModal
