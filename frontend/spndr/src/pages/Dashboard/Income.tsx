import React, { useCallback, useState } from 'react'
import dayjs from 'dayjs'
import toast from 'react-hot-toast'
import { IoAdd, IoPencil, IoTrash } from 'react-icons/io5'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import Modal from '../../components/ui/Modal'
import Pagination from '../../components/ui/Pagination'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import FormField, { TextAreaField } from '../../components/forms/FormField'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { ApiResponse, Income, IncomeFormData, PaginatedIncome } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatCurrency, toDateInputValue } from '../../utils/format'

const PAGE_LIMIT = 10

const emptyForm = (): IncomeFormData => ({
    title: '',
    amount: '',
    date: toDateInputValue(new Date()),
    source: '',
    description: '',
    category: '',
})

interface IncomePageData {
    items: Income[]
    meta: PaginatedIncome['meta']
}

const Income = () => {
    const [page, setPage] = useState(1)
    const [formOpen, setFormOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState<IncomeFormData>(emptyForm)
    const [submitting, setSubmitting] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<Income | null>(null)
    const [deleting, setDeleting] = useState(false)

    const fetchIncome = useCallback(async (): Promise<IncomePageData> => {
        try {
            const response = await axiosInstance.get<ApiResponse<PaginatedIncome>>(
                API_PATHS.INCOME.GET_ALL,
                { params: { page, limit: PAGE_LIMIT } }
            )
            const payload = unwrapApiData(response)
            return { items: payload.data, meta: payload.meta }
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load income'))
        }
    }, [page])

    const { data, loading, error, refetch } = useAsyncData(fetchIncome, [fetchIncome])

    const openCreate = () => {
        setEditingId(null)
        setForm(emptyForm())
        setFormOpen(true)
    }

    const openEdit = (item: Income) => {
        setEditingId(item._id)
        setForm({
            title: item.title,
            amount: String(item.amount),
            date: toDateInputValue(item.date),
            source: item.source ?? '',
            description: item.description ?? '',
            category: item.category ?? '',
        })
        setFormOpen(true)
    }

    const closeForm = () => {
        setFormOpen(false)
        setEditingId(null)
        setForm(emptyForm())
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!form.title.trim() || !form.amount || !form.date) {
            toast.error('Title, amount, and date are required')
            return
        }

        const payload = {
            title: form.title.trim(),
            amount: Number(form.amount),
            date: form.date,
            source: form.source.trim() || undefined,
            description: form.description.trim() || undefined,
            category: form.category.trim() || undefined,
        }

        setSubmitting(true)
        try {
            if (editingId) {
                await axiosInstance.put(API_PATHS.INCOME.UPDATE(editingId), payload)
                toast.success('Income updated')
            } else {
                await axiosInstance.post(API_PATHS.INCOME.CREATE, payload)
                toast.success('Income added')
            }
            closeForm()
            if (!editingId) setPage(1)
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to save income'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async () => {
        if (!deleteTarget) return

        setDeleting(true)
        try {
            await axiosInstance.delete(API_PATHS.INCOME.DELETE(deleteTarget._id))
            toast.success('Income deleted')
            setDeleteTarget(null)
            if (data?.items.length === 1 && page > 1) {
                setPage((p) => p - 1)
            } else {
                await refetch()
            }
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to delete income'))
        } finally {
            setDeleting(false)
        }
    }

    return (
        <div>
            <PageHeader
                title="Income"
                description="Track and manage your income entries"
                actions={
                    <button
                        type="button"
                        onClick={openCreate}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors"
                    >
                        <IoAdd size={18} />
                        Add income
                    </button>
                }
            />

            <AsyncContent
                loading={loading}
                error={error}
                data={data}
                isEmpty={(result) => result.items.length === 0}
                loadingMessage="Loading income..."
                emptyTitle="No income yet"
                emptyDescription="Add your first income entry to start tracking."
                onRetry={refetch}
            >
                {(result) => (
                    <>
                        <div className="space-y-3">
                            {result.items.map((item) => (
                                <div key={item._id} className="card flex items-center justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-slate-200 truncate">{item.title}</p>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            {dayjs(item.date).format('MMM D, YYYY')}
                                            {item.category ? ` · ${item.category}` : ''}
                                            {item.source ? ` · ${item.source}` : ''}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <p className="text-sm font-semibold text-cyan-400">
                                            {formatCurrency(item.amount)}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => openEdit(item)}
                                            className="p-1.5 text-slate-400 hover:text-cyan-400 transition-colors"
                                            aria-label="Edit income"
                                        >
                                            <IoPencil size={16} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDeleteTarget(item)}
                                            className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors"
                                            aria-label="Delete income"
                                        >
                                            <IoTrash size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <Pagination
                            page={result.meta.pageNumber}
                            totalPages={result.meta.totalPages}
                            totalItems={result.meta.totalIncomes}
                            onPageChange={setPage}
                        />
                    </>
                )}
            </AsyncContent>

            <Modal
                open={formOpen}
                onClose={closeForm}
                title={editingId ? 'Edit income' : 'Add income'}
            >
                <form onSubmit={handleSubmit} className="space-y-4">
                    <FormField
                        label="Title"
                        value={form.title}
                        onChange={(v) => setForm((f) => ({ ...f, title: v }))}
                        placeholder="Salary, freelance, etc."
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
                    <FormField
                        label="Source"
                        value={form.source}
                        onChange={(v) => setForm((f) => ({ ...f, source: v }))}
                        placeholder="Employer or client"
                        disabled={submitting}
                    />
                    <FormField
                        label="Category"
                        value={form.category}
                        onChange={(v) => setForm((f) => ({ ...f, category: v }))}
                        placeholder="Salary, side hustle, etc."
                        disabled={submitting}
                    />
                    <TextAreaField
                        label="Description"
                        value={form.description}
                        onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                        placeholder="Optional notes"
                        disabled={submitting}
                    />
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={closeForm}
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 text-slate-300 hover:border-slate-600 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors disabled:opacity-50"
                        >
                            {submitting ? 'Saving...' : editingId ? 'Update' : 'Add income'}
                        </button>
                    </div>
                </form>
            </Modal>

            <ConfirmDialog
                open={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDelete}
                title="Delete income"
                message={`Are you sure you want to delete "${deleteTarget?.title}"? This action cannot be undone.`}
                loading={deleting}
            />
        </div>
    )
}

export default Income
