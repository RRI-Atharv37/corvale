import React, { useCallback, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { IoAdd, IoPencil, IoTrash, IoTime } from 'react-icons/io5'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import Modal from '../../components/ui/Modal'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import PaginatedCardList from '../../components/ui/PaginatedCardList'
import FormField from '../../components/forms/FormField'
import CategoryPicker from '../../components/categories/CategoryPicker'
import BudgetProgressBar from '../../components/budgets/BudgetProgressBar'
import AccountMultiSelect from '../../components/budgets/AccountMultiSelect'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import { usePageSize } from '../../hooks/usePaginatedList'
import { useUser } from '../../hooks/useUser'
import { useWorkspace } from '../../hooks/useWorkspace'
import WorkspaceReadOnlyBanner from '../../components/workspaces/WorkspaceReadOnlyBanner'
import { buildWorkspaceBodyFields, buildWorkspaceQueryParams } from '../../utils/workspaceScope'
import type {
    Account,
    ApiResponse,
    Budget,
    BudgetFormData,
    BudgetPeriodType,
    BudgetScopeType,
    CategoriesResponse,
} from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatBudgetPeriod, getCurrentMonthYear, toDateInputValue } from '../../utils/format'
import { CategoryIcon } from '../../utils/categoryIcons'
import { DEFAULT_CURRENCY } from '../../utils/currencies'
import CurrencySelect from '../../components/inputs/CurrencySelect'

type BudgetView = 'active' | 'history'

const MONTH_OPTIONS = [
    { value: '1', label: 'January' },
    { value: '2', label: 'February' },
    { value: '3', label: 'March' },
    { value: '4', label: 'April' },
    { value: '5', label: 'May' },
    { value: '6', label: 'June' },
    { value: '7', label: 'July' },
    { value: '8', label: 'August' },
    { value: '9', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
]

const emptyForm = (preferredCurrency = DEFAULT_CURRENCY): BudgetFormData => {
    const { year, month } = getCurrentMonthYear()
    const today = toDateInputValue(new Date())
    return {
        name: '',
        periodType: 'monthly',
        year: String(year),
        month: String(month),
        periodStart: today,
        periodEnd: today,
        scopeType: 'overall',
        categoryId: '',
        amount: '',
        currency: preferredCurrency,
        rollover: false,
        accountIds: [],
        useAllAccounts: true,
    }
}

const isBudgetActive = (budget: Budget): boolean => {
    if (budget.isArchived) return false
    const now = new Date()
    const end = new Date(budget.periodEnd)
    return end >= now
}

interface SelectFieldProps {
    label: string
    value: string
    onChange: (value: string) => void
    options: { value: string; label: string }[]
    required?: boolean
    disabled?: boolean
}

const SelectField: React.FC<SelectFieldProps> = ({
    label,
    value,
    onChange,
    options,
    required,
    disabled,
}) => (
    <div>
        <label className="text-[13px] text-fg-secondary">
            {label}
            {required && <span className="text-expense ml-0.5">*</span>}
        </label>
        <div className="input-box mb-0 mt-1">
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                required={required}
                disabled={disabled}
                className="w-full bg-transparent outline-none text-fg"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value} className="bg-surface">
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    </div>
)

const resolveCategoryLabel = (
    categoryId: string | null | undefined,
    categories: CategoriesResponse | null
): { name: string; icon?: string; color?: string } => {
    if (!categoryId || !categories) {
        return { name: 'Overall' }
    }
    const match =
        categories.masters.find((c) => c._id === categoryId) ??
        categories.userCategories.find((c) => c._id === categoryId)
    return match
        ? { name: match.name, icon: match.icon, color: match.color }
        : { name: 'Category' }
}

const budgetToForm = (budget: Budget): BudgetFormData => {
    const start = new Date(budget.periodStart)
    return {
        name: budget.name ?? '',
        periodType: budget.periodType,
        year: String(start.getUTCFullYear()),
        month: String(start.getUTCMonth() + 1),
        periodStart: toDateInputValue(budget.periodStart),
        periodEnd: toDateInputValue(budget.periodEnd),
        scopeType: budget.categoryId ? 'category' : 'overall',
        categoryId: budget.categoryId ?? '',
        amount: String(budget.amount),
        currency: budget.currency,
        rollover: budget.rollover,
        accountIds: budget.accountIds ?? [],
        useAllAccounts: !budget.accountIds || budget.accountIds.length === 0,
    }
}

const Budgets = () => {
    const { user } = useUser()
    const { activeWorkspaceId, canEdit, isPersonal, activeWorkspace } = useWorkspace()
    const preferredCurrency = user?.preferredCurrency ?? DEFAULT_CURRENCY
    const pageSize = usePageSize()
    const [view, setView] = useState<BudgetView>('active')
    const [createOpen, setCreateOpen] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const [form, setForm] = useState<BudgetFormData>(emptyForm)
    const [editingBudget, setEditingBudget] = useState<Budget | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [archiveTarget, setArchiveTarget] = useState<Budget | null>(null)
    const [archiving, setArchiving] = useState(false)

    const fetchBudgets = useCallback(async (): Promise<Budget[]> => {
        try {
            const response = await axiosInstance.get<ApiResponse<Budget[]>>(API_PATHS.BUDGETS.GET_ALL, {
                params: {
                    includeArchived: view === 'history' ? 'true' : 'false',
                    ...buildWorkspaceQueryParams(activeWorkspaceId),
                },
            })
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load budgets'))
        }
    }, [view, activeWorkspaceId])

    const fetchCategories = useCallback(async (): Promise<CategoriesResponse> => {
        const response = await axiosInstance.get<ApiResponse<CategoriesResponse>>(
            API_PATHS.CATEGORIES.GET_ALL
        )
        return unwrapApiData(response)
    }, [])

    const fetchAccounts = useCallback(async (): Promise<Account[]> => {
        const response = await axiosInstance.get<ApiResponse<Account[]>>(API_PATHS.ACCOUNTS.GET_ALL, {
            params: buildWorkspaceQueryParams(activeWorkspaceId),
        })
        return unwrapApiData(response).filter((account) => !account.isArchived)
    }, [activeWorkspaceId])

    const { data: budgets, loading, error, refetch } = useAsyncData(fetchBudgets, [fetchBudgets])
    const { data: categories } = useAsyncData(fetchCategories, [fetchCategories])
    const { data: accounts } = useAsyncData(fetchAccounts, [fetchAccounts])

    const displayedBudgets = useMemo(() => {
        if (!budgets) return []
        if (view === 'history') {
            return budgets.filter((budget) => budget.isArchived || !isBudgetActive(budget))
        }
        return budgets.filter((budget) => isBudgetActive(budget))
    }, [budgets, view])

    const openCreate = () => {
        setForm(emptyForm(preferredCurrency))
        setCreateOpen(true)
    }

    const closeCreate = () => {
        setCreateOpen(false)
        setForm(emptyForm(preferredCurrency))
    }

    const openEdit = (budget: Budget) => {
        setEditingBudget(budget)
        setForm(budgetToForm(budget))
        setEditOpen(true)
    }

    const closeEdit = () => {
        setEditOpen(false)
        setEditingBudget(null)
        setForm(emptyForm(preferredCurrency))
    }

    const buildPayload = (formData: BudgetFormData) => {
        const amount = Number(formData.amount)
        if (isNaN(amount) || amount <= 0) {
            throw new Error('Budget amount must be a positive number')
        }

        if (formData.scopeType === 'category' && !formData.categoryId) {
            throw new Error('Select a category for category budgets')
        }

        if (
            !formData.useAllAccounts &&
            formData.accountIds.length === 0 &&
            (accounts?.length ?? 0) > 0
        ) {
            throw new Error('Select at least one account or use all accounts')
        }

        const payload: Record<string, unknown> = {
            name: formData.name.trim() || undefined,
            periodType: formData.periodType,
            amount,
            currency: formData.currency,
            rollover: formData.rollover,
            categoryId: formData.scopeType === 'overall' ? null : formData.categoryId,
            accountIds: formData.useAllAccounts ? [] : formData.accountIds,
        }

        if (formData.periodType === 'monthly') {
            payload.year = Number(formData.year)
            payload.month = Number(formData.month)
        } else {
            payload.periodStart = formData.periodStart
            payload.periodEnd = formData.periodEnd
        }

        return payload
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitting(true)
        try {
            const payload = buildPayload(form)
            await axiosInstance.post(API_PATHS.BUDGETS.CREATE, {
                ...payload,
                ...buildWorkspaceBodyFields(activeWorkspaceId),
            })
            toast.success('Budget created')
            closeCreate()
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, err instanceof Error ? err.message : 'Failed to create budget'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingBudget) return

        setSubmitting(true)
        try {
            const payload = buildPayload(form)
            await axiosInstance.put(API_PATHS.BUDGETS.UPDATE(editingBudget._id), payload)
            toast.success('Budget updated')
            closeEdit()
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, err instanceof Error ? err.message : 'Failed to update budget'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleArchive = async () => {
        if (!archiveTarget) return

        setArchiving(true)
        try {
            await axiosInstance.delete(API_PATHS.BUDGETS.DELETE(archiveTarget._id))
            toast.success('Budget archived')
            setArchiveTarget(null)
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to archive budget'))
        } finally {
            setArchiving(false)
        }
    }

    const renderFormFields = (mode: 'create' | 'edit') => (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <FormField
                label="Name (optional)"
                value={form.name}
                onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                placeholder="Groceries, Monthly spending, etc."
                disabled={submitting}
            />

            <SelectField
                label="Period type"
                value={form.periodType}
                onChange={(v) =>
                    setForm((f) => ({ ...f, periodType: v as BudgetPeriodType }))
                }
                options={[
                    { value: 'monthly', label: 'Monthly' },
                    { value: 'custom', label: 'Custom duration' },
                ]}
                required
                disabled={submitting || mode === 'edit'}
            />

            {form.periodType === 'monthly' ? (
                <div className="grid grid-cols-2 gap-3">
                    <SelectField
                        label="Month"
                        value={form.month}
                        onChange={(v) => setForm((f) => ({ ...f, month: v }))}
                        options={MONTH_OPTIONS}
                        required
                        disabled={submitting}
                    />
                    <FormField
                        label="Year"
                        type="number"
                        value={form.year}
                        onChange={(v) => setForm((f) => ({ ...f, year: v }))}
                        required
                        disabled={submitting}
                        min="2000"
                        max="2100"
                    />
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    <FormField
                        label="Start date"
                        type="date"
                        value={form.periodStart}
                        onChange={(v) => setForm((f) => ({ ...f, periodStart: v }))}
                        required
                        disabled={submitting}
                    />
                    <FormField
                        label="End date"
                        type="date"
                        value={form.periodEnd}
                        onChange={(v) => setForm((f) => ({ ...f, periodEnd: v }))}
                        required
                        disabled={submitting}
                    />
                </div>
            )}

            <SelectField
                label="Budget scope"
                value={form.scopeType}
                onChange={(v) =>
                    setForm((f) => ({
                        ...f,
                        scopeType: v as BudgetScopeType,
                        categoryId: v === 'overall' ? '' : f.categoryId,
                    }))
                }
                options={[
                    { value: 'overall', label: 'Overall spending' },
                    { value: 'category', label: 'Category' },
                ]}
                required
                disabled={submitting}
            />

            {form.scopeType === 'category' && (
                <CategoryPicker
                    label="Category"
                    value={form.categoryId}
                    onChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
                    required
                    disabled={submitting}
                    categoriesData={categories ?? undefined}
                />
            )}

            <div className="grid grid-cols-2 gap-3">
                <FormField
                    label="Amount"
                    type="number"
                    value={form.amount}
                    onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
                    placeholder="500.00"
                    required
                    disabled={submitting}
                    step="0.01"
                    min="0.01"
                />
                <CurrencySelect
                    value={form.currency}
                    onChange={(v) => setForm((f) => ({ ...f, currency: v }))}
                    required
                    disabled={submitting}
                />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
                <input
                    type="checkbox"
                    checked={form.rollover}
                    onChange={(e) => setForm((f) => ({ ...f, rollover: e.target.checked }))}
                    disabled={submitting}
                    className="rounded border-border bg-surface text-accent focus:ring-accent/30"
                />
                <span className="text-sm text-fg-secondary">Rollover unused amount to next period</span>
            </label>

            <div>
                <p className="text-[13px] text-fg-secondary mb-2">Accounts</p>
                {accounts && (
                    <AccountMultiSelect
                        accounts={accounts}
                        selectedIds={form.useAllAccounts ? [] : form.accountIds}
                        onChange={(ids) =>
                            setForm((f) => ({
                                ...f,
                                accountIds: ids,
                                useAllAccounts: ids.length === 0,
                            }))
                        }
                        disabled={submitting}
                    />
                )}
            </div>
        </div>
    )

    return (
        <div>
            <PageHeader
                title="Budgets"
                description={
                    isPersonal
                        ? 'Set spending limits and track progress against your expenses'
                        : `Shared budgets in ${activeWorkspace?.name ?? 'workspace'}`
                }
                actions={
                    canEdit ? (
                        <button
                            type="button"
                            onClick={openCreate}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors"
                        >
                            <IoAdd size={18} />
                            Create budget
                        </button>
                    ) : undefined
                }
            />

            <WorkspaceReadOnlyBanner />

            <div className="flex gap-2 mb-6">
                <button
                    type="button"
                    onClick={() => setView('active')}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                        view === 'active'
                            ? 'bg-accent-subtle text-accent border border-accent/30'
                            : 'text-fg-muted border border-border-subtle hover:border-border'
                    }`}
                >
                    Active
                </button>
                <button
                    type="button"
                    onClick={() => setView('history')}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                        view === 'history'
                            ? 'bg-accent-subtle text-accent border border-accent/30'
                            : 'text-fg-muted border border-border-subtle hover:border-border'
                    }`}
                >
                    <IoTime size={16} />
                    History
                </button>
            </div>

            <AsyncContent
                loading={loading}
                error={error}
                data={displayedBudgets}
                isEmpty={(items) => items.length === 0}
                loadingMessage="Loading budgets..."
                emptyTitle={view === 'active' ? 'No active budgets' : 'No budget history'}
                emptyDescription={
                    view === 'active'
                        ? 'Create a budget to start tracking your spending limits.'
                        : 'Past and archived budgets will appear here.'
                }
                onRetry={refetch}
            >
                {(items) => (
                    <PaginatedCardList items={items} pageSize={pageSize}>
                        {(paginatedItems) => (
                    <div className="space-y-4">
                        {paginatedItems.map((budget) => {
                            const categoryMeta = resolveCategoryLabel(
                                budget.categoryId,
                                categories
                            )
                            const progress = budget.progress
                            const accountLabel =
                                budget.accountIds.length === 0
                                    ? 'All accounts'
                                    : `${budget.accountIds.length} account${budget.accountIds.length === 1 ? '' : 's'}`

                            return (
                                <div
                                    key={budget._id}
                                    className={`card space-y-4 ${
                                        progress?.isOverBudget
                                            ? 'border-negative/30 bg-negative/5'
                                            : ''
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-sm font-medium text-fg">
                                                    {budget.name ||
                                                        `${categoryMeta.name} budget`}
                                                </p>
                                                {budget.isArchived && (
                                                    <span className="rounded-full bg-surface-hover border border-border px-2 py-0.5 text-[11px] text-fg-muted">
                                                        Archived
                                                    </span>
                                                )}
                                                {progress?.isOverBudget && (
                                                    <span className="rounded-full bg-expense/10 border border-negative/20 px-2 py-0.5 text-[11px] font-medium text-expense">
                                                        Over budget
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-fg-muted mt-1">
                                                {formatBudgetPeriod(
                                                    budget.periodStart,
                                                    budget.periodEnd,
                                                    budget.periodType
                                                )}{' '}
                                                · {accountLabel}
                                                {budget.rollover && ' · Rollover enabled'}
                                            </p>
                                            <div className="flex items-center gap-2 mt-2">
                                                <span
                                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border"
                                                    style={{
                                                        backgroundColor: `${categoryMeta.color ?? '#6B7280'}20`,
                                                    }}
                                                >
                                                    <CategoryIcon
                                                        icon={categoryMeta.icon}
                                                        color={categoryMeta.color}
                                                        size={14}
                                                    />
                                                </span>
                                                <span className="text-xs text-fg-muted">
                                                    {categoryMeta.name}
                                                </span>
                                            </div>
                                        </div>
                                        {!budget.isArchived && view === 'active' && canEdit && (
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => openEdit(budget)}
                                                    className="p-1.5 text-fg-muted hover:text-accent transition-colors"
                                                    aria-label="Edit budget"
                                                >
                                                    <IoPencil size={16} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setArchiveTarget(budget)}
                                                    className="p-1.5 text-fg-muted hover:text-expense transition-colors"
                                                    aria-label="Archive budget"
                                                >
                                                    <IoTrash size={16} />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {progress ? (
                                        <BudgetProgressBar
                                            spent={progress.spent}
                                            remaining={progress.remaining}
                                            budgetAmount={progress.budgetAmount}
                                            percentUsed={progress.percentUsed}
                                            isOverBudget={progress.isOverBudget}
                                            currency={budget.currency}
                                        />
                                    ) : (
                                        <p className="text-xs text-fg-muted">Progress unavailable</p>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                        )}
                    </PaginatedCardList>
                )}
            </AsyncContent>

            <Modal open={createOpen} onClose={closeCreate} title="Create budget">
                <form onSubmit={handleCreate} className="space-y-4">
                    {renderFormFields('create')}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={closeCreate}
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
                            {submitting ? 'Creating...' : 'Create budget'}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal open={editOpen} onClose={closeEdit} title="Edit budget">
                <form onSubmit={handleEdit} className="space-y-4">
                    {renderFormFields('edit')}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={closeEdit}
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
                            {submitting ? 'Saving...' : 'Save changes'}
                        </button>
                    </div>
                </form>
            </Modal>

            <ConfirmDialog
                open={archiveTarget !== null}
                onClose={() => setArchiveTarget(null)}
                onConfirm={handleArchive}
                title="Archive budget"
                message={`Archive "${archiveTarget?.name ?? 'this budget'}"? It will move to history.`}
                confirmLabel="Archive"
                loading={archiving}
            />
        </div>
    )
}

export default Budgets
