import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '@ui/Modal'
import FormField from '@ui/forms/FormField'
import AccountPicker from '@features/accounts/components/AccountPicker'
import CategoryPicker from '@features/categories/components/CategoryPicker'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { useAsyncData } from '@/app/hooks/useAsyncData'
import { useWorkspace } from '@/app/providers/useWorkspace'
import { buildWorkspaceBodyFields } from '@lib/workspaceScope'
import { getApiErrorMessage } from '@lib/apiError'
import { toDateInputValue } from '@lib/format'
import type { ApiResponse } from '@lib/types/api'
import type { CategoriesResponse } from '@features/categories/types'
import { unwrapApiData } from '@lib/apiHelpers'

interface QuickTransactionModalProps {
    type: 'income' | 'expense'
    open: boolean
    onClose: () => void
    onCreated: () => void
}

const emptyState = () => ({
    title: '',
    amount: '',
    date: toDateInputValue(new Date()),
    accountId: '',
    categoryId: '',
})

const QuickTransactionModal: React.FC<QuickTransactionModalProps> = ({ type, open, onClose, onCreated }) => {
    const { activeWorkspaceId } = useWorkspace()
    const [form, setForm] = useState(emptyState())
    const [submitting, setSubmitting] = useState(false)

    const fetchCategories = useCallback(async (): Promise<CategoriesResponse> => {
        const response = await axiosInstance.get<ApiResponse<CategoriesResponse>>(API_PATHS.CATEGORIES.GET_ALL)
        return unwrapApiData(response)
    }, [])

    const { data: categories } = useAsyncData(fetchCategories, [fetchCategories])
    const incomeMasterId = categories?.masters.find((m) => m.name === 'Income')?._id

    useEffect(() => {
        if (open) {
            setForm(emptyState())
        }
    }, [open, type])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!form.title.trim() || !form.amount || !form.date || !form.accountId || !form.categoryId) {
            toast.error('Title, amount, date, account, and category are required')
            return
        }

        setSubmitting(true)
        try {
            await axiosInstance.post(API_PATHS.TRANSACTIONS.CREATE, {
                type,
                title: form.title.trim(),
                amount: Number(form.amount),
                date: form.date,
                accountId: form.accountId,
                categoryId: form.categoryId,
                ...buildWorkspaceBodyFields(activeWorkspaceId),
            })
            toast.success(type === 'income' ? 'Income added' : 'Expense added')
            onCreated()
            onClose()
        } catch (error) {
            toast.error(getApiErrorMessage(error, `Failed to add ${type}`))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Modal open={open} onClose={onClose} title={type === 'income' ? 'Add income' : 'Add expense'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <FormField
                    label="Title"
                    value={form.title}
                    onChange={(v) => setForm((f) => ({ ...f, title: v }))}
                    placeholder={type === 'income' ? 'Salary, freelance, etc.' : 'Groceries, rent, etc.'}
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
                    required
                    disabled={submitting}
                />
                <CategoryPicker
                    value={form.categoryId}
                    onChange={(categoryId) => setForm((f) => ({ ...f, categoryId }))}
                    masterCategoryId={type === 'income' ? incomeMasterId : undefined}
                    categoriesData={categories ?? undefined}
                    required
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
                        className="flex-1 px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors disabled:opacity-50"
                    >
                        {submitting ? 'Saving...' : type === 'income' ? 'Add income' : 'Add expense'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}

export default QuickTransactionModal
