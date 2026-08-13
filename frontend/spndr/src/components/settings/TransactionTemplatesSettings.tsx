import React, { useCallback, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { IoAdd, IoPencil, IoTrash } from 'react-icons/io5'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useWorkspace } from '../../hooks/useWorkspace'
import type {
    Account,
    ApiResponse,
    CategoriesResponse,
    Tag,
    TransactionTemplate,
    TransactionTemplateFormData,
    TransactionTemplateType,
} from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatCurrency } from '../../utils/format'
import { buildWorkspaceQueryParams } from '../../utils/workspaceScope'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import FormField, { TextAreaField } from '../forms/FormField'
import AccountPicker from '../accounts/AccountPicker'
import CategoryPicker from '../categories/CategoryPicker'
import TagPicker from '../tags/TagPicker'
import TagChip from '../tags/TagChip'

const emptyForm = (): TransactionTemplateFormData => ({
    name: '',
    type: 'expense',
    amount: '',
    accountId: '',
    categoryId: '',
    tags: [],
    description: '',
})

const templateToForm = (template: TransactionTemplate): TransactionTemplateFormData => ({
    name: template.name,
    type: template.type,
    amount: String(template.amount),
    accountId: template.accountId,
    categoryId: template.categoryId,
    tags: template.tags ?? [],
    description: template.description ?? '',
})

interface TypeSelectProps {
    value: TransactionTemplateType
    onChange: (value: TransactionTemplateType) => void
    disabled?: boolean
}

const TypeSelect: React.FC<TypeSelectProps> = ({ value, onChange, disabled }) => (
    <label className="block text-sm text-text-secondary">
        Type
        <select
            value={value}
            onChange={(event) => onChange(event.target.value as TransactionTemplateType)}
            disabled={disabled}
            className="mt-2 w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent/40 focus:outline-none"
        >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
        </select>
    </label>
)

const TransactionTemplatesSettings: React.FC = () => {
    const { activeWorkspaceId } = useWorkspace()
    const [formOpen, setFormOpen] = useState(false)
    const [editingTemplate, setEditingTemplate] = useState<TransactionTemplate | null>(null)
    const [form, setForm] = useState<TransactionTemplateFormData>(emptyForm())
    const [submitting, setSubmitting] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<TransactionTemplate | null>(null)
    const [deleting, setDeleting] = useState(false)

    const fetchTemplates = useCallback(async (): Promise<TransactionTemplate[]> => {
        const response = await axiosInstance.get<ApiResponse<TransactionTemplate[]>>(
            API_PATHS.TRANSACTION_TEMPLATES.GET_ALL
        )
        return unwrapApiData(response)
    }, [])

    const fetchLookups = useCallback(async () => {
        const workspaceParams = buildWorkspaceQueryParams(activeWorkspaceId)
        const [accountsRes, categoriesRes, tagsRes] = await Promise.all([
            axiosInstance.get<ApiResponse<Account[]>>(API_PATHS.ACCOUNTS.GET_ALL, {
                params: workspaceParams,
            }),
            axiosInstance.get<ApiResponse<CategoriesResponse>>(API_PATHS.CATEGORIES.GET_ALL),
            axiosInstance.get<ApiResponse<Tag[]>>(API_PATHS.TAGS.GET_ALL),
        ])
        return {
            accounts: unwrapApiData(accountsRes),
            categories: unwrapApiData(categoriesRes),
            tags: unwrapApiData(tagsRes),
        }
    }, [activeWorkspaceId])

    const {
        data: templates,
        loading,
        error,
        refetch,
    } = useAsyncData(fetchTemplates, [fetchTemplates])

    const { data: lookups } = useAsyncData(fetchLookups, [fetchLookups])

    const availableAccountIds = useMemo(
        () =>
            new Set(
                (lookups?.accounts ?? [])
                    .filter((account) => !account.isArchived)
                    .map((account) => account._id)
            ),
        [lookups?.accounts]
    )

    const visibleTemplates = useMemo(
        () => (templates ?? []).filter((template) => availableAccountIds.has(template.accountId)),
        [templates, availableAccountIds]
    )

    const getAccountName = (accountId: string): string =>
        lookups?.accounts.find((account) => account._id === accountId)?.name ?? 'Account'

    const getCategoryName = (categoryId: string): string => {
        const categories = lookups?.categories
        if (!categories) return 'Category'
        const match = [...categories.masters, ...categories.userCategories].find(
            (category) => category._id === categoryId
        )
        return match?.name ?? 'Category'
    }

    const openCreate = () => {
        setEditingTemplate(null)
        setForm(emptyForm())
        setFormOpen(true)
    }

    const openEdit = (template: TransactionTemplate) => {
        setEditingTemplate(template)
        setForm(templateToForm(template))
        setFormOpen(true)
    }

    const closeForm = () => {
        setFormOpen(false)
        setEditingTemplate(null)
        setForm(emptyForm())
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()

        if (!form.name.trim()) {
            toast.error('Template name is required')
            return
        }
        if (!form.amount.trim()) {
            toast.error('Amount is required')
            return
        }
        if (!form.accountId) {
            toast.error('Account is required')
            return
        }
        if (!form.categoryId) {
            toast.error('Category is required')
            return
        }

        setSubmitting(true)
        try {
            const payload = {
                name: form.name.trim(),
                type: form.type,
                amount: form.amount,
                accountId: form.accountId,
                categoryId: form.categoryId,
                tags: form.tags,
                description: form.description.trim() || undefined,
            }

            if (editingTemplate) {
                await axiosInstance.put(
                    API_PATHS.TRANSACTION_TEMPLATES.UPDATE(editingTemplate._id),
                    payload
                )
                toast.success('Template updated')
            } else {
                await axiosInstance.post(API_PATHS.TRANSACTION_TEMPLATES.CREATE, payload)
                toast.success('Template created')
            }

            closeForm()
            await refetch()
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to save template'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async () => {
        if (!deleteTarget) return

        setDeleting(true)
        try {
            await axiosInstance.delete(API_PATHS.TRANSACTION_TEMPLATES.DELETE(deleteTarget._id))
            toast.success('Template deleted')
            setDeleteTarget(null)
            await refetch()
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to delete template'))
        } finally {
            setDeleting(false)
        }
    }

    return (
        <div>
            <div className="flex items-center justify-between gap-3 mb-3">
                <p className="section-label">Quick-add templates</p>
                <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80 transition-colors"
                >
                    <IoAdd size={14} />
                    Add
                </button>
            </div>

            {loading ? (
                <p className="text-sm text-text-muted">Loading templates...</p>
            ) : error ? (
                <p className="text-sm text-destructive">{error}</p>
            ) : visibleTemplates.length === 0 ? (
                <p className="text-sm text-text-muted">
                    Save transaction presets for one-tap entry from the dashboard or transactions page.
                </p>
            ) : (
                <ul className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {visibleTemplates.map((template) => (
                        <li
                            key={template._id}
                            className="flex items-start justify-between gap-2 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2"
                        >
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-text-primary truncate">{template.name}</p>
                                <p className="text-xs text-text-muted mt-0.5">
                                    {template.type} · {formatCurrency(template.amount)} ·{' '}
                                    {getAccountName(template.accountId)} · {getCategoryName(template.categoryId)}
                                </p>
                                {template.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                        {template.tags.map((tag) => (
                                            <TagChip key={tag} name={tag} />
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => openEdit(template)}
                                    className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent-subtle transition-colors"
                                    aria-label={`Edit ${template.name}`}
                                >
                                    <IoPencil size={14} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDeleteTarget(template)}
                                    className="p-1.5 rounded-md text-text-muted hover:text-destructive hover:bg-destructive/10 transition-colors"
                                    aria-label={`Delete ${template.name}`}
                                >
                                    <IoTrash size={14} />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <Modal
                open={formOpen}
                onClose={closeForm}
                title={editingTemplate ? 'Edit template' : 'New quick-add template'}
                size="md"
            >
                <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
                    <FormField
                        label="Name"
                        value={form.name}
                        onChange={(value) => setForm((current) => ({ ...current, name: value }))}
                        required
                        placeholder="Coffee, Rent, Paycheck..."
                    />
                    <TypeSelect
                        value={form.type}
                        onChange={(type) => setForm((current) => ({ ...current, type }))}
                        disabled={submitting}
                    />
                    <FormField
                        label="Amount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={form.amount}
                        onChange={(value) => setForm((current) => ({ ...current, amount: value }))}
                        required
                    />
                    <AccountPicker
                        value={form.accountId}
                        onChange={(accountId) => setForm((current) => ({ ...current, accountId }))}
                        required
                        disabled={submitting}
                        accountsData={lookups?.accounts.filter((account) => !account.isArchived)}
                    />
                    <CategoryPicker
                        value={form.categoryId}
                        onChange={(categoryId) => setForm((current) => ({ ...current, categoryId }))}
                        required
                        disabled={submitting}
                        categoriesData={lookups?.categories}
                    />
                    <TagPicker
                        value={form.tags}
                        onChange={(tags) => setForm((current) => ({ ...current, tags }))}
                        disabled={submitting}
                        tagsData={lookups?.tags}
                    />
                    <TextAreaField
                        label="Description"
                        value={form.description}
                        onChange={(value) => setForm((current) => ({ ...current, description: value }))}
                        rows={2}
                        placeholder="Optional note saved on the transaction"
                    />
                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={closeForm}
                            disabled={submitting}
                            className="px-4 py-2 text-sm font-medium rounded-lg border border-border-subtle text-text-muted hover:text-text-primary transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors disabled:opacity-60"
                        >
                            {submitting ? 'Saving...' : editingTemplate ? 'Save changes' : 'Create template'}
                        </button>
                    </div>
                </form>
            </Modal>

            <ConfirmDialog
                open={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                onConfirm={() => void handleDelete()}
                title="Delete template"
                message={`Delete "${deleteTarget?.name ?? 'this template'}"? This cannot be undone.`}
                confirmLabel="Delete"
                loading={deleting}
            />
        </div>
    )
}

export default TransactionTemplatesSettings
