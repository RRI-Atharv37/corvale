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
import TagPicker from '../../components/tags/TagPicker'
import AccountPicker from '../../components/accounts/AccountPicker'
import CurrencySelect from '../../components/Inputs/CurrencySelect'
import RecurringCalendar from '../../components/recurring/RecurringCalendar'
import OfflineNotice from '../../components/ui/OfflineNotice'
import { usePageSize } from '../../hooks/usePaginatedList'
import { useUser } from '../../hooks/useUser'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useRecurringData, type RecurringRuleInput } from './hooks/useRecurringData'
import { useRecurringDrafts } from './hooks/useRecurringDrafts'
import { useAccountsData } from './hooks/useAccountsData'
import { useCategoriesData } from './hooks/useCategoriesData'
import { useTagsData } from './hooks/useTagsData'
import type {
    CategoriesResponse,
    RecurringRule,
    RecurringRuleFormData,
    RecurringRuleType,
    RecurringInterval,
    Transaction,
} from '../../types/api'
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
    tags: [],
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
    tags: rule.tags ?? [],
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

    const online = useOnlineStatus()
    const [view, setView] = useState<RecurringView>('rules')
    const [ruleListView, setRuleListView] = useState<RuleListView>('active')
    const [createOpen, setCreateOpen] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const [form, setForm] = useState<RecurringRuleFormData>(emptyForm)
    const [editingRule, setEditingRule] = useState<RecurringRule | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [archiveTarget, setArchiveTarget] = useState<RecurringRule | null>(null)
    const [archiving, setArchiving] = useState(false)
    const [selectedDraft, setSelectedDraft] = useState<Transaction | null>(null)
    const { year: initialYear, month: initialMonth } = getCurrentMonthYear()
    const [calendarYear, setCalendarYear] = useState(initialYear)
    const [calendarMonth, setCalendarMonth] = useState(initialMonth)

    const { rules, loading, error, refetch, createRule, updateRule, archiveRule, toggleRuleActive } =
        useRecurringData()
    const { categories } = useCategoriesData()
    const { accounts } = useAccountsData()
    const { tags, refetch: refetchTags } = useTagsData()
    const {
        drafts,
        draftsLoading,
        draftsError,
        generatingDrafts,
        draftActionId,
        fetchDrafts,
        generateAndRefreshDrafts,
        confirmDraft,
        dismissDraft,
    } = useRecurringDrafts(refetch)

    const handleGenerateDrafts = useCallback(async () => {
        try {
            await generateAndRefreshDrafts()
            toast.success('Drafts synced')
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to generate drafts'))
        }
    }, [generateAndRefreshDrafts])

    useEffect(() => {
        void fetchDrafts()
    }, [fetchDrafts])

    useEffect(() => {
        if (view === 'drafts') {
            void handleGenerateDrafts()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view])

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

    const buildPayload = (formData: RecurringRuleFormData): RecurringRuleInput => {
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

        return {
            title: formData.title.trim(),
            type: formData.type,
            amount,
            currency: formData.currency,
            accountId: formData.accountId,
            categoryId: formData.categoryId,
            interval: formData.interval,
            customIntervalDays: formData.interval === 'custom' ? Number(formData.customIntervalDays) : undefined,
            nextDueDate: formData.nextDueDate,
            description: formData.description.trim() || undefined,
            paymentMethod: formData.paymentMethod.trim() || undefined,
            tags: formData.tags,
            isActive: formData.isActive,
        }
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitting(true)
        try {
            const payload = buildPayload(form)
            await createRule(payload)
            toast.success('Recurring rule created')
            closeCreate()
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
            await updateRule(editingRule, payload)
            toast.success('Recurring rule updated')
            closeEdit()
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
            await archiveRule(archiveTarget)
            toast.success('Recurring rule archived')
            setArchiveTarget(null)
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to archive rule'))
        } finally {
            setArchiving(false)
        }
    }

    const handleToggleRuleActive = async (rule: RecurringRule) => {
        try {
            await toggleRuleActive(rule)
            toast.success(rule.isActive ? 'Rule paused' : 'Rule resumed')
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to update rule'))
        }
    }

    const handleConfirmDraft = async (draft: Transaction) => {
        try {
            await confirmDraft(draft)
            toast.success('Draft confirmed and posted')
            setSelectedDraft(null)
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to confirm draft'))
        }
    }

    const handleDismissDraft = async (draft: Transaction) => {
        try {
            await dismissDraft(draft)
            toast.success('Draft dismissed')
            setSelectedDraft(null)
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to dismiss draft'))
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

            <TagPicker
                value={form.tags}
                onChange={(tags) => setForm((f) => ({ ...f, tags }))}
                tagsData={tags ?? undefined}
                onTagsChange={refetchTags}
                disabled={submitting}
            />

            <label className="flex items-center gap-2 cursor-pointer">
                <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                    disabled={submitting}
                    className="rounded border-border bg-surface text-accent focus:ring-accent/30"
                />
                <span className="text-sm text-fg-secondary">Active (generates drafts when due)</span>
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
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors"
                        >
                            <IoAdd size={18} />
                            Create rule
                        </button>
                    ) : view === 'drafts' ? (
                        <button
                            type="button"
                            onClick={() => void handleGenerateDrafts()}
                            disabled={generatingDrafts || !online}
                            title={online ? undefined : 'Draft sync requires a connection'}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-border text-fg-secondary hover:border-accent/40 hover:text-accent transition-colors disabled:opacity-50"
                        >
                            <IoRefresh size={16} className={generatingDrafts ? 'animate-spin' : ''} />
                            {generatingDrafts ? 'Syncing...' : 'Sync drafts'}
                        </button>
                    ) : undefined
                }
            />

            {(view === 'drafts' || view === 'calendar') && !online && (
                <OfflineNotice message="You are offline. Draft sync, confirm, and dismiss require a connection." />
            )}

            <div className="flex flex-wrap gap-2 mb-6">
                <button
                    type="button"
                    onClick={() => setView('rules')}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                        view === 'rules'
                            ? 'bg-accent-subtle text-accent border border-accent/30'
                            : 'text-fg-muted border border-border-subtle hover:border-border'
                    }`}
                >
                    Rules
                </button>
                <button
                    type="button"
                    onClick={() => setView('drafts')}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                        view === 'drafts'
                            ? 'bg-accent-subtle text-accent border border-accent/30'
                            : 'text-fg-muted border border-border-subtle hover:border-border'
                    }`}
                >
                    <IoMail size={16} />
                    Draft inbox
                    {drafts.length > 0 && (
                        <span className="rounded-full bg-warning/20 text-warning px-1.5 py-0.5 text-[11px]">
                            {drafts.length}
                        </span>
                    )}
                </button>
                <button
                    type="button"
                    onClick={() => setView('calendar')}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                        view === 'calendar'
                            ? 'bg-accent-subtle text-accent border border-accent/30'
                            : 'text-fg-muted border border-border-subtle hover:border-border'
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
                                    ? 'bg-surface-hover text-fg border border-border'
                                    : 'text-fg-muted border border-border-subtle hover:border-border'
                            }`}
                        >
                            Active
                        </button>
                        <button
                            type="button"
                            onClick={() => setRuleListView('archived')}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                ruleListView === 'archived'
                                    ? 'bg-surface-hover text-fg border border-border'
                                    : 'text-fg-muted border border-border-subtle hover:border-border'
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
                                                        <p className="text-sm font-medium text-fg">
                                                            {rule.title}
                                                        </p>
                                                        <span
                                                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                                                rule.type === 'income'
                                                                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                                                                    : 'bg-expense/10 border-negative/20 text-expense'
                                                            }`}
                                                        >
                                                            {rule.type}
                                                        </span>
                                                        {!rule.isActive && !rule.isArchived && (
                                                            <span className="rounded-full bg-warning/10 border border-warning/20 px-2 py-0.5 text-[11px] text-warning">
                                                                Paused
                                                            </span>
                                                        )}
                                                        {rule.isArchived && (
                                                            <span className="rounded-full bg-surface-hover border border-border px-2 py-0.5 text-[11px] text-fg-muted">
                                                                Archived
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-fg-muted mt-1">
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
                                                        <span className="text-xs text-fg-muted">
                                                            ·{' '}
                                                            {formatCurrency(rule.amount, rule.currency)}
                                                        </span>
                                                    </div>
                                                </div>
                                                {!rule.isArchived && ruleListView === 'active' && (
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleToggleRuleActive(rule)}
                                                            className="p-1.5 text-fg-muted hover:text-warning transition-colors"
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
                                                            className="p-1.5 text-fg-muted hover:text-accent transition-colors"
                                                            aria-label="Edit rule"
                                                        >
                                                            <IoPencil size={16} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setArchiveTarget(rule)}
                                                            className="p-1.5 text-fg-muted hover:text-expense transition-colors"
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
                    onRetry={() => void handleGenerateDrafts()}
                >
                    {(items) => (
                        <PaginatedCardList items={items} pageSize={pageSize}>
                            {(paginatedItems) => (
                        <div className="space-y-4">
                            {paginatedItems.map((draft) => {
                                const isActing = draftActionId === draft._id || !online
                                return (
                                    <div
                                        key={draft._id}
                                        className="card flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-warning/20 bg-warning/5"
                                    >
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-sm font-medium text-fg">
                                                    {draft.title}
                                                </p>
                                                <span className="rounded-full bg-warning/10 border border-warning/20 px-2 py-0.5 text-[11px] text-warning">
                                                    Draft
                                                </span>
                                                <span
                                                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                                                        draft.type === 'income'
                                                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                                                            : 'bg-expense/10 border-negative/20 text-expense'
                                                    }`}
                                                >
                                                    {draft.type}
                                                </span>
                                            </div>
                                            <p className="text-xs text-fg-muted mt-1">
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
                                                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-border text-fg-muted hover:text-expense hover:border-negative/30 transition-colors disabled:opacity-50"
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
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-border text-fg-secondary hover:border-border transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors disabled:opacity-50"
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
                title="Archive recurring rule"
                message={`Archive "${archiveTarget?.title ?? 'this rule'}"? It will stop generating drafts.`}
                confirmLabel="Archive"
                loading={archiving}
            />

            <ConfirmDialog
                open={selectedDraft !== null}
                onClose={() => setSelectedDraft(null)}
                onConfirm={() => {
                    if (selectedDraft && online) void handleConfirmDraft(selectedDraft)
                }}
                title="Confirm draft"
                message={
                    selectedDraft
                        ? `Post "${selectedDraft.title}" for ${formatCurrency(selectedDraft.amount, selectedDraft.currency)} on ${formatDisplayDate(selectedDraft.date)}?${online ? '' : ' You are offline - reconnect to confirm.'}`
                        : ''
                }
                confirmLabel="Confirm & post"
                loading={draftActionId === selectedDraft?._id || !online}
            />
        </div>
    )
}

export default Recurring
