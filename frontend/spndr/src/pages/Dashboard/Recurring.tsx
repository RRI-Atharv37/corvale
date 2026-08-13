import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
    IoAdd,
    IoPencil,
    IoTrash,
    IoTime,
    IoCalendar,
    IoMail,
    IoCheckmarkCircle,
    IoCloseCircle,
    IoRefresh,
    IoPause,
    IoPlay,
} from 'react-icons/io5'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import Modal from '../../components/ui/Modal'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import PaginatedCardList from '../../components/ui/PaginatedCardList'
import FormField from '../../components/forms/FormField'
import CategoryPicker from '../../components/categories/CategoryPicker'
import AccountPicker from '../../components/accounts/AccountPicker'
import CurrencySelect from '../../components/inputs/CurrencySelect'
import RecurringCalendar from '../../components/recurring/RecurringCalendar'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import { usePageSize } from '../../hooks/usePaginatedList'
import { useUser } from '../../hooks/useUser'
import type {
    Account,
    ApiResponse,
    CategoriesResponse,
    RecurringRule,
    RecurringRuleFormData,
    RecurringRuleType,
    RecurringInterval,
    Transaction,
} from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatCurrency, formatDisplayDate, getCurrentMonthYear, toDateInputValue } from '../../utils/format'
import { CategoryIcon } from '../../utils/categoryIcons'
import { DEFAULT_CURRENCY } from '../../utils/currencies'
import { formatIntervalLabel, INTERVAL_OPTIONS } from '../../utils/recurringUtils'

type RecurringView = 'rules' | 'drafts' | 'calendar'
type RuleListView = 'active' | 'archived'

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
        <label className="text-[13px] text-slate-300">
            {label}
            {required && <span className="text-rose-400 ml-0.5">*</span>}
        </label>
        <div className="input-box mb-0 mt-1">
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                required={required}
                disabled={disabled}
                className="w-full bg-transparent outline-none text-slate-200"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value} className="bg-slate-900">
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    </div>
)

const emptyForm = (preferredCurrency = DEFAULT_CURRENCY): RecurringRuleFormData => ({
    title: '',
    type: 'expense',
    amount: '',
    currency: preferredCurrency,
    accountId: '',
    categoryId: '',
    interval: 'monthly',
    customIntervalDays: '30',
    nextDueDate: toDateInputValue(new Date()),
    description: '',
    paymentMethod: '',
    tags: '',
    isActive: true,
})

const ruleToForm = (rule: RecurringRule): RecurringRuleFormData => ({
    title: rule.title,
    type: rule.type,
    amount: String(rule.amount),
    currency: rule.currency,
    accountId: rule.accountId,
    categoryId: rule.categoryId,
    interval: rule.interval,
    customIntervalDays: String(rule.customIntervalDays ?? 30),
    nextDueDate: toDateInputValue(rule.nextDueDate),
    description: rule.description ?? '',
    paymentMethod: rule.paymentMethod ?? '',
    tags: rule.tags?.join(', ') ?? '',
    isActive: rule.isActive,
})

const resolveCategoryLabel = (
    categoryId: string,
    categories: CategoriesResponse | null
): { name: string; icon?: string; color?: string } => {
    if (!categories) return { name: 'Category' }
    const match =
        categories.masters.find((c) => c._id === categoryId) ??
        categories.userCategories.find((c) => c._id === categoryId)
    return match
        ? { name: match.name, icon: match.icon, color: match.color }
        : { name: 'Category' }
}

const Recurring = () => {
    const { user } = useUser()
    const preferredCurrency = user?.preferredCurrency ?? DEFAULT_CURRENCY
    const pageSize = usePageSize()

    const [view, setView] = useState<RecurringView>('rules')
    const [ruleListView, setRuleListView] = useState<RuleListView>('active')
    const [createOpen, setCreateOpen] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const [form, setForm] = useState<RecurringRuleFormData>(emptyForm)
    const [editingRule, setEditingRule] = useState<RecurringRule | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [archiveTarget, setArchiveTarget] = useState<RecurringRule | null>(null)
    const [archiving, setArchiving] = useState(false)
    const [drafts, setDrafts] = useState<Transaction[]>([])
    const [draftsLoading, setDraftsLoading] = useState(false)
    const [draftsError, setDraftsError] = useState<string | null>(null)
    const [generatingDrafts, setGeneratingDrafts] = useState(false)
    const [draftActionId, setDraftActionId] = useState<string | null>(null)
    const [selectedDraft, setSelectedDraft] = useState<Transaction | null>(null)
    const { year: initialYear, month: initialMonth } = getCurrentMonthYear()
    const [calendarYear, setCalendarYear] = useState(initialYear)
    const [calendarMonth, setCalendarMonth] = useState(initialMonth)

    const fetchRules = useCallback(async (): Promise<RecurringRule[]> => {
        try {
            const response = await axiosInstance.get<ApiResponse<RecurringRule[]>>(
                API_PATHS.RECURRING_RULES.GET_ALL,
                {
                    params: {
                        includeArchived: ruleListView === 'archived' ? 'true' : 'false',
                    },
                }
            )
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load recurring rules'))
        }
    }, [ruleListView])

    const fetchCategories = useCallback(async (): Promise<CategoriesResponse> => {
        const response = await axiosInstance.get<ApiResponse<CategoriesResponse>>(
            API_PATHS.CATEGORIES.GET_ALL
        )
        return unwrapApiData(response)
    }, [])

    const fetchAccounts = useCallback(async (): Promise<Account[]> => {
        const response = await axiosInstance.get<ApiResponse<Account[]>>(API_PATHS.ACCOUNTS.GET_ALL)
        return unwrapApiData(response).filter((account) => !account.isArchived)
    }, [])

    const { data: rules, loading, error, refetch } = useAsyncData(fetchRules, [fetchRules])
    const { data: categories } = useAsyncData(fetchCategories, [fetchCategories])
    const { data: accounts } = useAsyncData(fetchAccounts, [fetchAccounts])

    const fetchDrafts = useCallback(async () => {
        setDraftsLoading(true)
        setDraftsError(null)
        try {
            const response = await axiosInstance.get<ApiResponse<Transaction[]>>(
                API_PATHS.RECURRING_RULES.GET_DRAFTS
            )
            setDrafts(unwrapApiData(response))
        } catch (err) {
            setDraftsError(getApiErrorMessage(err, 'Failed to load drafts'))
        } finally {
            setDraftsLoading(false)
        }
    }, [])

    const generateAndRefreshDrafts = useCallback(async () => {
        setGeneratingDrafts(true)
        try {
            await axiosInstance.post(API_PATHS.RECURRING_RULES.GENERATE_DRAFTS)
            await fetchDrafts()
            await refetch()
            toast.success('Drafts synced')
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to generate drafts'))
        } finally {
            setGeneratingDrafts(false)
        }
    }, [fetchDrafts, refetch])

    useEffect(() => {
        void fetchDrafts()
    }, [fetchDrafts])

    useEffect(() => {
        if (view === 'drafts') {
            void generateAndRefreshDrafts()
        }
    }, [view, generateAndRefreshDrafts])

    const displayedRules = useMemo(() => {
        if (!rules) return []
        if (ruleListView === 'archived') {
            return rules.filter((rule) => rule.isArchived)
        }
        return rules.filter((rule) => !rule.isArchived)
    }, [rules, ruleListView])

    const activeRulesForCalendar = useMemo(() => {
        return (rules ?? []).filter((rule) => rule.isActive && !rule.isArchived)
    }, [rules])

    const resolveAccountName = (accountId: string): string => {
        const account = accounts?.find((item) => item._id === accountId)
        return account?.name ?? 'Account'
    }

    const resolveRuleTitle = (recurringPaymentId: string | null | undefined): string => {
        if (!recurringPaymentId || !rules) return 'Recurring bill'
        const rule = rules.find((item) => item._id === recurringPaymentId)
        return rule?.title ?? 'Recurring bill'
    }

    const openCreate = () => {
        setForm(emptyForm(preferredCurrency))
        setCreateOpen(true)
    }

    const closeCreate = () => {
        setCreateOpen(false)
        setForm(emptyForm(preferredCurrency))
    }

    const openEdit = (rule: RecurringRule) => {
        setEditingRule(rule)
        setForm(ruleToForm(rule))
        setEditOpen(true)
    }

    const closeEdit = () => {
        setEditOpen(false)
        setEditingRule(null)
        setForm(emptyForm(preferredCurrency))
    }

    const buildPayload = (formData: RecurringRuleFormData) => {
        const amount = Number(formData.amount)
        if (isNaN(amount) || amount <= 0) {
            throw new Error('Amount must be a positive number')
        }
        if (!formData.accountId) {
            throw new Error('Select an account')
        }
        if (!formData.categoryId) {
            throw new Error('Select a category')
        }
        if (formData.interval === 'custom') {
            const days = Number(formData.customIntervalDays)
            if (!Number.isInteger(days) || days < 1) {
                throw new Error('Custom interval days must be a positive integer')
            }
        }

        const payload: Record<string, unknown> = {
            title: formData.title.trim(),
            type: formData.type,
            amount,
            currency: formData.currency,
            accountId: formData.accountId,
            categoryId: formData.categoryId,
            interval: formData.interval,
            nextDueDate: formData.nextDueDate,
            description: formData.description.trim() || undefined,
            paymentMethod: formData.paymentMethod.trim() || undefined,
            tags: formData.tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
            isActive: formData.isActive,
        }

        if (formData.interval === 'custom') {
            payload.customIntervalDays = Number(formData.customIntervalDays)
        }

        return payload
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitting(true)
        try {
            const payload = buildPayload(form)
            await axiosInstance.post(API_PATHS.RECURRING_RULES.CREATE, payload)
            toast.success('Recurring rule created')
            closeCreate()
            await refetch()
        } catch (err) {
            toast.error(
                getApiErrorMessage(err, err instanceof Error ? err.message : 'Failed to create rule')
            )
        } finally {
            setSubmitting(false)
        }
    }

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingRule) return

        setSubmitting(true)
        try {
            const payload = buildPayload(form)
            await axiosInstance.put(API_PATHS.RECURRING_RULES.UPDATE(editingRule._id), payload)
            toast.success('Recurring rule updated')
            closeEdit()
            await refetch()
        } catch (err) {
            toast.error(
                getApiErrorMessage(err, err instanceof Error ? err.message : 'Failed to update rule')
            )
        } finally {
            setSubmitting(false)
        }
    }

    const handleArchive = async () => {
        if (!archiveTarget) return

        setArchiving(true)
        try {
            await axiosInstance.delete(API_PATHS.RECURRING_RULES.DELETE(archiveTarget._id))
            toast.success('Recurring rule archived')
            setArchiveTarget(null)
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to archive rule'))
        } finally {
            setArchiving(false)
        }
    }

    const toggleRuleActive = async (rule: RecurringRule) => {
        try {
            await axiosInstance.put(API_PATHS.RECURRING_RULES.UPDATE(rule._id), {
                isActive: !rule.isActive,
            })
            toast.success(rule.isActive ? 'Rule paused' : 'Rule resumed')
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to update rule'))
        }
    }

    const handleConfirmDraft = async (draft: Transaction) => {
        setDraftActionId(draft._id)
        try {
            await axiosInstance.post(API_PATHS.RECURRING_RULES.CONFIRM_DRAFT(draft._id))
            toast.success('Draft confirmed and posted')
            setSelectedDraft(null)
            await fetchDrafts()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to confirm draft'))
        } finally {
            setDraftActionId(null)
        }
    }

    const handleDismissDraft = async (draft: Transaction) => {
        setDraftActionId(draft._id)
        try {
            await axiosInstance.post(API_PATHS.RECURRING_RULES.DISMISS_DRAFT(draft._id))
            toast.success('Draft dismissed')
            setSelectedDraft(null)
            await fetchDrafts()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to dismiss draft'))
        } finally {
            setDraftActionId(null)
        }
    }

    const goToPrevMonth = () => {
        if (calendarMonth === 1) {
            setCalendarYear((y) => y - 1)
            setCalendarMonth(12)
        } else {
            setCalendarMonth((m) => m - 1)
        }
    }

    const goToNextMonth = () => {
        if (calendarMonth === 12) {
            setCalendarYear((y) => y + 1)
            setCalendarMonth(1)
        } else {
            setCalendarMonth((m) => m + 1)
        }
    }

    const renderFormFields = () => (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <FormField
                label="Title"
                value={form.title}
                onChange={(v) => setForm((f) => ({ ...f, title: v }))}
                placeholder="Rent, Netflix, Salary, etc."
                required
                disabled={submitting}
            />

            <SelectField
                label="Type"
                value={form.type}
                onChange={(v) => setForm((f) => ({ ...f, type: v as RecurringRuleType }))}
                options={[
                    { value: 'expense', label: 'Expense' },
                    { value: 'income', label: 'Income' },
                ]}
                required
                disabled={submitting}
            />

            <div className="grid grid-cols-2 gap-3">
                <FormField
                    label="Amount"
                    type="number"
                    value={form.amount}
                    onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
                    placeholder="100.00"
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

            <AccountPicker
                value={form.accountId}
                onChange={(v) => setForm((f) => ({ ...f, accountId: v }))}
                required
                disabled={submitting}
                accountsData={accounts ?? undefined}
            />

            <CategoryPicker
                label="Category"
                value={form.categoryId}
                onChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
                required
                disabled={submitting}
                categoriesData={categories ?? undefined}
            />

            <SelectField
                label="Interval"
                value={form.interval}
                onChange={(v) => setForm((f) => ({ ...f, interval: v as RecurringInterval }))}
                options={INTERVAL_OPTIONS}
                required
                disabled={submitting}
            />

            {form.interval === 'custom' && (
                <FormField
                    label="Custom interval (days)"
                    type="number"
                    value={form.customIntervalDays}
                    onChange={(v) => setForm((f) => ({ ...f, customIntervalDays: v }))}
                    required
                    disabled={submitting}
                    min="1"
                />
            )}

            <FormField
                label="Next due date"
                type="date"
                value={form.nextDueDate}
                onChange={(v) => setForm((f) => ({ ...f, nextDueDate: v }))}
                required
                disabled={submitting}
            />

            <FormField
                label="Description (optional)"
                value={form.description}
                onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                disabled={submitting}
            />

            <FormField
                label="Payment method (optional)"
                value={form.paymentMethod}
                onChange={(v) => setForm((f) => ({ ...f, paymentMethod: v }))}
                disabled={submitting}
            />

            <FormField
                label="Tags (optional, comma-separated)"
                value={form.tags}
                onChange={(v) => setForm((f) => ({ ...f, tags: v }))}
                disabled={submitting}
            />

            <label className="flex items-center gap-2 cursor-pointer">
                <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                    disabled={submitting}
                    className="rounded border-slate-600 bg-slate-900 text-cyan-400 focus:ring-cyan-500/40"
                />
                <span className="text-sm text-slate-300">Active (generates drafts when due)</span>
            </label>
        </div>
    )

    return (
        <div>
            <PageHeader
                title="Recurring"
                description="Manage recurring bills and income templates with draft review before posting"
                actions={
                    view === 'rules' ? (
                        <button
                            type="button"
                            onClick={openCreate}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors"
                        >
                            <IoAdd size={18} />
                            Create rule
                        </button>
                    ) : view === 'drafts' ? (
                        <button
                            type="button"
                            onClick={() => void generateAndRefreshDrafts()}
                            disabled={generatingDrafts}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors disabled:opacity-50"
                        >
                            <IoRefresh size={16} className={generatingDrafts ? 'animate-spin' : ''} />
                            {generatingDrafts ? 'Syncing...' : 'Sync drafts'}
                        </button>
                    ) : undefined
                }
            />

            <div className="flex flex-wrap gap-2 mb-6">
                <button
                    type="button"
                    onClick={() => setView('rules')}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                        view === 'rules'
                            ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20'
                            : 'text-slate-400 border border-slate-800 hover:border-slate-700'
                    }`}
                >
                    Rules
                </button>
                <button
                    type="button"
                    onClick={() => setView('drafts')}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                        view === 'drafts'
                            ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20'
                            : 'text-slate-400 border border-slate-800 hover:border-slate-700'
                    }`}
                >
                    <IoMail size={16} />
                    Draft inbox
                    {drafts.length > 0 && (
                        <span className="rounded-full bg-amber-500/20 text-amber-200 px-1.5 py-0.5 text-[11px]">
                            {drafts.length}
                        </span>
                    )}
                </button>
                <button
                    type="button"
                    onClick={() => setView('calendar')}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                        view === 'calendar'
                            ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20'
                            : 'text-slate-400 border border-slate-800 hover:border-slate-700'
                    }`}
                >
                    <IoCalendar size={16} />
                    Calendar
                </button>
            </div>

            {view === 'rules' && (
                <>
                    <div className="flex gap-2 mb-6">
                        <button
                            type="button"
                            onClick={() => setRuleListView('active')}
                            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                ruleListView === 'active'
                                    ? 'bg-slate-800 text-slate-200 border border-slate-700'
                                    : 'text-slate-400 border border-slate-800 hover:border-slate-700'
                            }`}
                        >
                            Active
                        </button>
                        <button
                            type="button"
                            onClick={() => setRuleListView('archived')}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                ruleListView === 'archived'
                                    ? 'bg-slate-800 text-slate-200 border border-slate-700'
                                    : 'text-slate-400 border border-slate-800 hover:border-slate-700'
                            }`}
                        >
                            <IoTime size={16} />
                            Archived
                        </button>
                    </div>

                    <AsyncContent
                        loading={loading}
                        error={error}
                        data={displayedRules}
                        isEmpty={(items) => items.length === 0}
                        loadingMessage="Loading recurring rules..."
                        emptyTitle={
                            ruleListView === 'active' ? 'No recurring rules' : 'No archived rules'
                        }
                        emptyDescription={
                            ruleListView === 'active'
                                ? 'Create a rule to schedule recurring bills or income.'
                                : 'Archived rules will appear here.'
                        }
                        onRetry={refetch}
                    >
                        {(items) => (
                            <PaginatedCardList items={items} pageSize={pageSize}>
                                {(paginatedItems) => (
                            <div className="space-y-4">
                                {paginatedItems.map((rule) => {
                                    const categoryMeta = resolveCategoryLabel(
                                        rule.categoryId,
                                        categories
                                    )

                                    return (
                                        <div key={rule._id} className="card space-y-3">
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <p className="text-sm font-medium text-slate-200">
                                                            {rule.title}
                                                        </p>
                                                        <span
                                                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                                                rule.type === 'income'
                                                                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                                                                    : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                                                            }`}
                                                        >
                                                            {rule.type}
                                                        </span>
                                                        {!rule.isActive && !rule.isArchived && (
                                                            <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">
                                                                Paused
                                                            </span>
                                                        )}
                                                        {rule.isArchived && (
                                                            <span className="rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">
                                                                Archived
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-slate-500 mt-1">
                                                        {formatIntervalLabel(
                                                            rule.interval,
                                                            rule.customIntervalDays
                                                        )}{' '}
                                                        · Next due{' '}
                                                        {formatDisplayDate(rule.nextDueDate)} ·{' '}
                                                        {resolveAccountName(rule.accountId)}
                                                    </p>
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <span
                                                            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-700"
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
                                                        <span className="text-xs text-slate-400">
                                                            {categoryMeta.name}
                                                        </span>
                                                        <span className="text-xs text-slate-500">
                                                            ·{' '}
                                                            {formatCurrency(rule.amount, rule.currency)}
                                                        </span>
                                                    </div>
                                                </div>
                                                {!rule.isArchived && ruleListView === 'active' && (
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <button
                                                            type="button"
                                                            onClick={() => void toggleRuleActive(rule)}
                                                            className="p-1.5 text-slate-400 hover:text-amber-400 transition-colors"
                                                            aria-label={
                                                                rule.isActive ? 'Pause rule' : 'Resume rule'
                                                            }
                                                            title={rule.isActive ? 'Pause' : 'Resume'}
                                                        >
                                                            {rule.isActive ? (
                                                                <IoPause size={16} />
                                                            ) : (
                                                                <IoPlay size={16} />
                                                            )}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => openEdit(rule)}
                                                            className="p-1.5 text-slate-400 hover:text-cyan-400 transition-colors"
                                                            aria-label="Edit rule"
                                                        >
                                                            <IoPencil size={16} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setArchiveTarget(rule)}
                                                            className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors"
                                                            aria-label="Archive rule"
                                                        >
                                                            <IoTrash size={16} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                                )}
                            </PaginatedCardList>
                        )}
                    </AsyncContent>
                </>
            )}

            {view === 'drafts' && (
                <AsyncContent
                    loading={draftsLoading || generatingDrafts}
                    error={draftsError}
                    data={drafts}
                    isEmpty={(items) => items.length === 0}
                    loadingMessage="Loading draft inbox..."
                    emptyTitle="No pending drafts"
                    emptyDescription="When recurring rules are due, drafts appear here for review before posting."
                    onRetry={() => void generateAndRefreshDrafts()}
                >
                    {(items) => (
                        <PaginatedCardList items={items} pageSize={pageSize}>
                            {(paginatedItems) => (
                        <div className="space-y-4">
                            {paginatedItems.map((draft) => {
                                const isActing = draftActionId === draft._id
                                return (
                                    <div
                                        key={draft._id}
                                        className="card flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-amber-500/20 bg-amber-500/5"
                                    >
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-sm font-medium text-slate-200">
                                                    {draft.title}
                                                </p>
                                                <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">
                                                    Draft
                                                </span>
                                                <span
                                                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                                                        draft.type === 'income'
                                                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                                                            : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                                                    }`}
                                                >
                                                    {draft.type}
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-500 mt-1">
                                                Due {formatDisplayDate(draft.date)} ·{' '}
                                                {resolveRuleTitle(draft.recurringPaymentId)} ·{' '}
                                                {formatCurrency(draft.amount, draft.currency)}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => void handleConfirmDraft(draft)}
                                                disabled={isActing}
                                                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                                            >
                                                <IoCheckmarkCircle size={16} />
                                                Confirm
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void handleDismissDraft(draft)}
                                                disabled={isActing}
                                                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-700 text-slate-400 hover:text-rose-300 hover:border-rose-500/30 transition-colors disabled:opacity-50"
                                            >
                                                <IoCloseCircle size={16} />
                                                Dismiss
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                            )}
                        </PaginatedCardList>
                    )}
                </AsyncContent>
            )}

            {view === 'calendar' && (
                <div className="space-y-4">
                    <AsyncContent
                        loading={loading}
                        error={error}
                        data={activeRulesForCalendar}
                        isEmpty={() => false}
                        loadingMessage="Loading calendar..."
                        emptyTitle=""
                        emptyDescription=""
                        onRetry={refetch}
                    >
                        {() => (
                            <RecurringCalendar
                                year={calendarYear}
                                month={calendarMonth}
                                rules={activeRulesForCalendar}
                                drafts={drafts}
                                onPrevMonth={goToPrevMonth}
                                onNextMonth={goToNextMonth}
                                onSelectDraft={(draft) => setSelectedDraft(draft)}
                            />
                        )}
                    </AsyncContent>
                </div>
            )}

            <Modal open={createOpen} onClose={closeCreate} title="Create recurring rule">
                <form onSubmit={handleCreate} className="space-y-4">
                    {renderFormFields()}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={closeCreate}
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
                            {submitting ? 'Creating...' : 'Create rule'}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal open={editOpen} onClose={closeEdit} title="Edit recurring rule">
                <form onSubmit={handleEdit} className="space-y-4">
                    {renderFormFields()}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={closeEdit}
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
                            {submitting ? 'Saving...' : 'Save changes'}
                        </button>
                    </div>
                </form>
            </Modal>

            <ConfirmDialog
                open={archiveTarget !== null}
                onClose={() => setArchiveTarget(null)}
                onConfirm={handleArchive}
                title="Archive recurring rule"
                message={`Archive "${archiveTarget?.title ?? 'this rule'}"? It will stop generating drafts.`}
                confirmLabel="Archive"
                loading={archiving}
            />

            <ConfirmDialog
                open={selectedDraft !== null}
                onClose={() => setSelectedDraft(null)}
                onConfirm={() => {
                    if (selectedDraft) void handleConfirmDraft(selectedDraft)
                }}
                title="Confirm draft"
                message={
                    selectedDraft
                        ? `Post "${selectedDraft.title}" for ${formatCurrency(selectedDraft.amount, selectedDraft.currency)} on ${formatDisplayDate(selectedDraft.date)}?`
                        : ''
                }
                confirmLabel="Confirm & post"
                loading={draftActionId === selectedDraft?._id}
            />
        </div>
    )
}

export default Recurring
