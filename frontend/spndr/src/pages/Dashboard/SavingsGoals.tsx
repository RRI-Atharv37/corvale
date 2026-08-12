import React, { useCallback, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
    IoAdd,
    IoPencil,
    IoTrash,
    IoPause,
    IoPlay,
    IoCheckmarkCircle,
    IoTime,
    IoCash,
    IoRefresh,
} from 'react-icons/io5'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import Modal from '../../components/ui/Modal'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import FormField from '../../components/forms/FormField'
import SavingsGoalProgressBar from '../../components/savingsGoals/SavingsGoalProgressBar'
import CurrencySelect from '../../components/inputs/CurrencySelect'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useUser } from '../../hooks/useUser'
import type {
    Account,
    ApiResponse,
    AutoContributionInterval,
    ContributeResponse,
    SavingsGoal,
    SavingsGoalContribution,
    SavingsGoalFormData,
    SavingsGoalStatus,
} from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import {
    formatContributionDate,
    formatCurrency,
    formatGoalTargetDate,
    toDateInputValue,
} from '../../utils/format'
import { DEFAULT_CURRENCY } from '../../utils/currencies'

type GoalView = 'active' | 'completed' | 'archived'

const STATUS_LABELS: Record<SavingsGoalStatus, string> = {
    active: 'Active',
    paused: 'Paused',
    completed: 'Completed',
    archived: 'Archived',
}

const STATUS_BADGE_CLASSES: Record<SavingsGoalStatus, string> = {
    active: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300',
    paused: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
    completed: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
    archived: 'bg-slate-800 border-slate-700 text-slate-400',
}

const emptyForm = (preferredCurrency = DEFAULT_CURRENCY): SavingsGoalFormData => ({
    name: '',
    targetAmount: '',
    currency: preferredCurrency,
    targetDate: '',
    accountId: '',
    autoContributionEnabled: false,
    autoContributionAmount: '',
    autoContributionInterval: 'monthly',
    autoContributionDayOfMonth: '1',
})

const goalToForm = (goal: SavingsGoal): SavingsGoalFormData => ({
    name: goal.name,
    targetAmount: String(goal.targetAmount),
    currency: goal.currency,
    targetDate: goal.targetDate ? toDateInputValue(goal.targetDate) : '',
    accountId: goal.accountId ?? '',
    autoContributionEnabled: goal.autoContribution.enabled,
    autoContributionAmount: goal.autoContribution.enabled
        ? String(goal.autoContribution.amount)
        : '',
    autoContributionInterval: goal.autoContribution.interval,
    autoContributionDayOfMonth: String(goal.autoContribution.dayOfMonth ?? 1),
})

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

const SavingsGoals = () => {
    const { user } = useUser()
    const preferredCurrency = user?.preferredCurrency ?? DEFAULT_CURRENCY

    const [view, setView] = useState<GoalView>('active')
    const [createOpen, setCreateOpen] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const [contributeOpen, setContributeOpen] = useState(false)
    const [historyOpen, setHistoryOpen] = useState(false)
    const [form, setForm] = useState<SavingsGoalFormData>(emptyForm)
    const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null)
    const [actionGoal, setActionGoal] = useState<SavingsGoal | null>(null)
    const [contributeAmount, setContributeAmount] = useState('')
    const [contributeNote, setContributeNote] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [contributing, setContributing] = useState(false)
    const [autoContributing, setAutoContributing] = useState(false)
    const [confirmAction, setConfirmAction] = useState<
        'archive' | 'complete' | 'pause' | null
    >(null)
    const [actionLoading, setActionLoading] = useState(false)
    const [contributions, setContributions] = useState<SavingsGoalContribution[]>([])
    const [historyLoading, setHistoryLoading] = useState(false)

    const fetchGoals = useCallback(async (): Promise<SavingsGoal[]> => {
        try {
            const params: Record<string, string> = {}
            if (view === 'archived') {
                params.includeArchived = 'true'
                params.status = 'archived'
            } else if (view === 'completed') {
                params.status = 'completed'
            }
            const response = await axiosInstance.get<ApiResponse<SavingsGoal[]>>(
                API_PATHS.SAVINGS_GOALS.GET_ALL,
                { params }
            )
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load savings goals'))
        }
    }, [view])

    const fetchAccounts = useCallback(async (): Promise<Account[]> => {
        const response = await axiosInstance.get<ApiResponse<Account[]>>(API_PATHS.ACCOUNTS.GET_ALL)
        return unwrapApiData(response).filter((account) => !account.isArchived)
    }, [])

    const { data: goals, loading, error, refetch } = useAsyncData(fetchGoals, [fetchGoals])
    const { data: accounts } = useAsyncData(fetchAccounts, [fetchAccounts])

    const displayedGoals = useMemo(() => {
        if (!goals) return []
        if (view === 'active') {
            return goals.filter((goal) => goal.status === 'active' || goal.status === 'paused')
        }
        if (view === 'completed') {
            return goals.filter((goal) => goal.status === 'completed')
        }
        return goals.filter((goal) => goal.status === 'archived')
    }, [goals, view])

    const resolveAccountName = (accountId: string | null | undefined): string => {
        if (!accountId || !accounts) return 'No linked account'
        const account = accounts.find((item) => item._id === accountId)
        return account?.name ?? 'Linked account'
    }

    const buildPayload = (formData: SavingsGoalFormData) => {
        const targetAmount = Number(formData.targetAmount)
        if (isNaN(targetAmount) || targetAmount <= 0) {
            throw new Error('Target amount must be a positive number')
        }

        const payload: Record<string, unknown> = {
            name: formData.name.trim(),
            targetAmount,
            currency: formData.currency,
            targetDate: formData.targetDate || null,
            accountId: formData.accountId || null,
        }

        if (formData.autoContributionEnabled) {
            const autoAmount = Number(formData.autoContributionAmount)
            if (isNaN(autoAmount) || autoAmount <= 0) {
                throw new Error('Auto contribution amount must be a positive number')
            }
            payload.autoContribution = {
                enabled: true,
                amount: autoAmount,
                interval: formData.autoContributionInterval,
                dayOfMonth:
                    formData.autoContributionInterval === 'monthly'
                        ? Number(formData.autoContributionDayOfMonth)
                        : undefined,
            }
        } else {
            payload.autoContribution = { enabled: false, amount: 0, interval: 'monthly' }
        }

        return payload
    }

    const openCreate = () => {
        setForm(emptyForm(preferredCurrency))
        setCreateOpen(true)
    }

    const closeCreate = () => {
        setCreateOpen(false)
        setForm(emptyForm(preferredCurrency))
    }

    const openEdit = (goal: SavingsGoal) => {
        setEditingGoal(goal)
        setForm(goalToForm(goal))
        setEditOpen(true)
    }

    const closeEdit = () => {
        setEditOpen(false)
        setEditingGoal(null)
        setForm(emptyForm(preferredCurrency))
    }

    const openContribute = (goal: SavingsGoal) => {
        setActionGoal(goal)
        setContributeAmount('')
        setContributeNote('')
        setContributeOpen(true)
    }

    const closeContribute = () => {
        setContributeOpen(false)
        setActionGoal(null)
        setContributeAmount('')
        setContributeNote('')
    }

    const openHistory = async (goal: SavingsGoal) => {
        setActionGoal(goal)
        setHistoryOpen(true)
        setHistoryLoading(true)
        try {
            const response = await axiosInstance.get<ApiResponse<SavingsGoalContribution[]>>(
                API_PATHS.SAVINGS_GOALS.CONTRIBUTIONS(goal._id)
            )
            setContributions(unwrapApiData(response))
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to load contribution history'))
            setContributions([])
        } finally {
            setHistoryLoading(false)
        }
    }

    const closeHistory = () => {
        setHistoryOpen(false)
        setActionGoal(null)
        setContributions([])
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitting(true)
        try {
            const payload = buildPayload(form)
            await axiosInstance.post(API_PATHS.SAVINGS_GOALS.CREATE, payload)
            toast.success('Savings goal created')
            closeCreate()
            await refetch()
        } catch (err) {
            toast.error(
                getApiErrorMessage(err, err instanceof Error ? err.message : 'Failed to create goal')
            )
        } finally {
            setSubmitting(false)
        }
    }

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingGoal) return

        setSubmitting(true)
        try {
            const payload = buildPayload(form)
            await axiosInstance.put(API_PATHS.SAVINGS_GOALS.UPDATE(editingGoal._id), payload)
            toast.success('Savings goal updated')
            closeEdit()
            await refetch()
        } catch (err) {
            toast.error(
                getApiErrorMessage(err, err instanceof Error ? err.message : 'Failed to update goal')
            )
        } finally {
            setSubmitting(false)
        }
    }

    const handleContribute = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!actionGoal) return

        const amount = Number(contributeAmount)
        if (isNaN(amount) || amount <= 0) {
            toast.error('Enter a valid contribution amount')
            return
        }

        setContributing(true)
        try {
            await axiosInstance.post<ApiResponse<ContributeResponse['data']>>(
                API_PATHS.SAVINGS_GOALS.CONTRIBUTE(actionGoal._id),
                { amount, note: contributeNote.trim() || undefined }
            )
            toast.success('Contribution recorded')
            closeContribute()
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to record contribution'))
        } finally {
            setContributing(false)
        }
    }

    const handleAutoContribute = async (goal: SavingsGoal) => {
        setAutoContributing(true)
        try {
            await axiosInstance.post(API_PATHS.SAVINGS_GOALS.AUTO_CONTRIBUTE(goal._id))
            toast.success('Automatic contribution processed')
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to process automatic contribution'))
        } finally {
            setAutoContributing(false)
        }
    }

    const handleConfirmAction = async () => {
        if (!actionGoal || !confirmAction) return

        setActionLoading(true)
        try {
            if (confirmAction === 'archive') {
                await axiosInstance.delete(API_PATHS.SAVINGS_GOALS.DELETE(actionGoal._id))
                toast.success('Savings goal archived')
            } else if (confirmAction === 'complete') {
                await axiosInstance.post(API_PATHS.SAVINGS_GOALS.COMPLETE(actionGoal._id))
                toast.success('Savings goal marked complete')
            } else if (confirmAction === 'pause') {
                await axiosInstance.post(API_PATHS.SAVINGS_GOALS.PAUSE(actionGoal._id))
                toast.success('Savings goal paused')
            }
            setConfirmAction(null)
            setActionGoal(null)
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Action failed'))
        } finally {
            setActionLoading(false)
        }
    }

    const handleResume = async (goal: SavingsGoal) => {
        setActionLoading(true)
        try {
            await axiosInstance.post(API_PATHS.SAVINGS_GOALS.RESUME(goal._id))
            toast.success('Savings goal resumed')
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to resume goal'))
        } finally {
            setActionLoading(false)
        }
    }

    const renderGoalFormFields = () => (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <FormField
                label="Goal name"
                value={form.name}
                onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                placeholder="Emergency fund, New laptop, etc."
                required
                disabled={submitting}
            />

            <div className="grid grid-cols-2 gap-3">
                <FormField
                    label="Target amount"
                    type="number"
                    value={form.targetAmount}
                    onChange={(v) => setForm((f) => ({ ...f, targetAmount: v }))}
                    placeholder="1000.00"
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

            <FormField
                label="Target date (optional)"
                type="date"
                value={form.targetDate}
                onChange={(v) => setForm((f) => ({ ...f, targetDate: v }))}
                disabled={submitting}
            />

            <SelectField
                label="Linked account (optional)"
                value={form.accountId}
                onChange={(v) => setForm((f) => ({ ...f, accountId: v }))}
                options={[
                    { value: '', label: 'None' },
                    ...(accounts?.map((account) => ({
                        value: account._id,
                        label: `${account.name} (${account.type})`,
                    })) ?? []),
                ]}
                disabled={submitting}
            />

            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={form.autoContributionEnabled}
                        onChange={(e) =>
                            setForm((f) => ({ ...f, autoContributionEnabled: e.target.checked }))
                        }
                        disabled={submitting}
                        className="rounded border-slate-600 bg-slate-900 text-cyan-400 focus:ring-cyan-500/40"
                    />
                    <span className="text-sm text-slate-300">Enable automatic contributions</span>
                </label>

                {form.autoContributionEnabled && (
                    <>
                        <FormField
                            label="Auto contribution amount"
                            type="number"
                            value={form.autoContributionAmount}
                            onChange={(v) => setForm((f) => ({ ...f, autoContributionAmount: v }))}
                            placeholder="50.00"
                            required
                            disabled={submitting}
                            step="0.01"
                            min="0.01"
                        />
                        <SelectField
                            label="Interval"
                            value={form.autoContributionInterval}
                            onChange={(v) =>
                                setForm((f) => ({
                                    ...f,
                                    autoContributionInterval: v as AutoContributionInterval,
                                }))
                            }
                            options={[
                                { value: 'monthly', label: 'Monthly' },
                                { value: 'weekly', label: 'Weekly' },
                            ]}
                            required
                            disabled={submitting}
                        />
                        {form.autoContributionInterval === 'monthly' && (
                            <FormField
                                label="Day of month (1–28)"
                                type="number"
                                value={form.autoContributionDayOfMonth}
                                onChange={(v) =>
                                    setForm((f) => ({ ...f, autoContributionDayOfMonth: v }))
                                }
                                required
                                disabled={submitting}
                                min="1"
                                max="28"
                            />
                        )}
                    </>
                )}
            </div>
        </div>
    )

    const renderProgressMeta = (goal: SavingsGoal) => {
        const progress = goal.progress
        if (!progress) return null

        return (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                {progress.requiredMonthlyContribution !== null && (
                    <div className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wide">
                            Required monthly
                        </p>
                        <p className="text-sm font-medium text-slate-200 mt-0.5">
                            {formatCurrency(progress.requiredMonthlyContribution, goal.currency)}
                        </p>
                    </div>
                )}
                {progress.projectedCompletionDate && (
                    <div className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wide">
                            Projected completion
                        </p>
                        <p className="text-sm font-medium text-slate-200 mt-0.5">
                            {formatGoalTargetDate(progress.projectedCompletionDate)}
                        </p>
                    </div>
                )}
                {progress.monthsRemaining !== null && goal.targetDate && (
                    <div className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wide">
                            Months remaining
                        </p>
                        <p className="text-sm font-medium text-slate-200 mt-0.5">
                            {progress.monthsRemaining}
                        </p>
                    </div>
                )}
            </div>
        )
    }

    return (
        <div>
            <PageHeader
                title="Savings Goals"
                description="Set targets, track progress, and log contributions toward what matters"
                actions={
                    <button
                        type="button"
                        onClick={openCreate}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors"
                    >
                        <IoAdd size={18} />
                        Create goal
                    </button>
                }
            />

            <div className="flex flex-wrap gap-2 mb-6">
                {(['active', 'completed', 'archived'] as GoalView[]).map((tab) => (
                    <button
                        key={tab}
                        type="button"
                        onClick={() => setView(tab)}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors capitalize ${
                            view === tab
                                ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20'
                                : 'text-slate-400 border border-slate-800 hover:border-slate-700'
                        }`}
                    >
                        {tab === 'archived' && <IoTime className="inline mr-1.5 -mt-0.5" size={14} />}
                        {tab}
                    </button>
                ))}
            </div>

            <AsyncContent
                loading={loading}
                error={error}
                data={displayedGoals}
                isEmpty={(items) => items.length === 0}
                loadingMessage="Loading savings goals..."
                emptyTitle={
                    view === 'active'
                        ? 'No active savings goals'
                        : view === 'completed'
                          ? 'No completed goals'
                          : 'No archived goals'
                }
                emptyDescription={
                    view === 'active'
                        ? 'Create a savings goal to start tracking progress toward a target.'
                        : view === 'completed'
                          ? 'Goals you mark complete will appear here.'
                          : 'Archived goals will appear here.'
                }
                onRetry={refetch}
            >
                {(items) => (
                    <div className="space-y-4">
                        {items.map((goal) => {
                            const progress = goal.progress
                            const canContribute =
                                goal.status === 'active' && !progress?.isComplete

                            return (
                                <div
                                    key={goal._id}
                                    className={`card space-y-4 ${
                                        progress?.isComplete
                                            ? 'border-emerald-500/30 bg-emerald-500/5'
                                            : goal.status === 'paused'
                                              ? 'border-amber-500/20 bg-amber-500/5'
                                              : ''
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-sm font-medium text-slate-200">
                                                    {goal.name}
                                                </p>
                                                <span
                                                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE_CLASSES[goal.status]}`}
                                                >
                                                    {STATUS_LABELS[goal.status]}
                                                </span>
                                                {goal.autoContribution.enabled &&
                                                    goal.autoContribution.isDue &&
                                                    goal.status === 'active' && (
                                                        <span className="rounded-full bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 text-[11px] font-medium text-violet-300">
                                                            Auto due
                                                        </span>
                                                    )}
                                            </div>
                                            <p className="text-xs text-slate-500 mt-1">
                                                Target {formatGoalTargetDate(goal.targetDate)} ·{' '}
                                                {resolveAccountName(goal.accountId)}
                                                {goal.autoContribution.enabled &&
                                                    ` · Auto ${formatCurrency(goal.autoContribution.amount, goal.currency)}/${goal.autoContribution.interval}`}
                                            </p>
                                        </div>

                                        {view === 'active' && (
                                            <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                                                {canContribute && (
                                                    <button
                                                        type="button"
                                                        onClick={() => openContribute(goal)}
                                                        className="p-1.5 text-slate-400 hover:text-cyan-400 transition-colors"
                                                        aria-label="Add contribution"
                                                        title="Add contribution"
                                                    >
                                                        <IoCash size={16} />
                                                    </button>
                                                )}
                                                {goal.autoContribution.enabled &&
                                                    goal.autoContribution.isDue &&
                                                    goal.status === 'active' && (
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleAutoContribute(goal)}
                                                            disabled={autoContributing}
                                                            className="p-1.5 text-slate-400 hover:text-violet-400 transition-colors disabled:opacity-50"
                                                            aria-label="Process auto contribution"
                                                            title="Process auto contribution"
                                                        >
                                                            <IoRefresh size={16} />
                                                        </button>
                                                    )}
                                                <button
                                                    type="button"
                                                    onClick={() => void openHistory(goal)}
                                                    className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors"
                                                    aria-label="View contribution history"
                                                    title="Contribution history"
                                                >
                                                    <IoTime size={16} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => openEdit(goal)}
                                                    className="p-1.5 text-slate-400 hover:text-cyan-400 transition-colors"
                                                    aria-label="Edit goal"
                                                >
                                                    <IoPencil size={16} />
                                                </button>
                                                {goal.status === 'active' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setActionGoal(goal)
                                                            setConfirmAction('pause')
                                                        }}
                                                        className="p-1.5 text-slate-400 hover:text-amber-400 transition-colors"
                                                        aria-label="Pause goal"
                                                        title="Pause"
                                                    >
                                                        <IoPause size={16} />
                                                    </button>
                                                )}
                                                {goal.status === 'paused' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleResume(goal)}
                                                        disabled={actionLoading}
                                                        className="p-1.5 text-slate-400 hover:text-cyan-400 transition-colors disabled:opacity-50"
                                                        aria-label="Resume goal"
                                                        title="Resume"
                                                    >
                                                        <IoPlay size={16} />
                                                    </button>
                                                )}
                                                {goal.status !== 'completed' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setActionGoal(goal)
                                                            setConfirmAction('complete')
                                                        }}
                                                        className="p-1.5 text-slate-400 hover:text-emerald-400 transition-colors"
                                                        aria-label="Mark complete"
                                                        title="Mark complete"
                                                    >
                                                        <IoCheckmarkCircle size={16} />
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setActionGoal(goal)
                                                        setConfirmAction('archive')
                                                    }}
                                                    className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors"
                                                    aria-label="Archive goal"
                                                >
                                                    <IoTrash size={16} />
                                                </button>
                                            </div>
                                        )}

                                        {view !== 'active' && (
                                            <button
                                                type="button"
                                                onClick={() => void openHistory(goal)}
                                                className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
                                                aria-label="View contribution history"
                                                title="Contribution history"
                                            >
                                                <IoTime size={16} />
                                            </button>
                                        )}
                                    </div>

                                    {progress ? (
                                        <>
                                            <SavingsGoalProgressBar
                                                currentAmount={progress.currentAmount}
                                                targetAmount={progress.targetAmount}
                                                remaining={progress.remaining}
                                                percentComplete={progress.percentComplete}
                                                isComplete={progress.isComplete}
                                                currency={goal.currency}
                                            />
                                            {renderProgressMeta(goal)}
                                        </>
                                    ) : (
                                        <p className="text-xs text-slate-500">Progress unavailable</p>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </AsyncContent>

            <Modal open={createOpen} onClose={closeCreate} title="Create savings goal">
                <form onSubmit={handleCreate} className="space-y-4">
                    {renderGoalFormFields()}
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
                            {submitting ? 'Creating...' : 'Create goal'}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal open={editOpen} onClose={closeEdit} title="Edit savings goal">
                <form onSubmit={handleEdit} className="space-y-4">
                    {renderGoalFormFields()}
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

            <Modal open={contributeOpen} onClose={closeContribute} title="Add contribution">
                <form onSubmit={handleContribute} className="space-y-4">
                    {actionGoal && (
                        <p className="text-sm text-slate-400">
                            Contributing to <span className="text-slate-200">{actionGoal.name}</span>
                        </p>
                    )}
                    <FormField
                        label="Amount"
                        type="number"
                        value={contributeAmount}
                        onChange={setContributeAmount}
                        placeholder="50.00"
                        required
                        disabled={contributing}
                        step="0.01"
                        min="0.01"
                    />
                    <FormField
                        label="Note (optional)"
                        value={contributeNote}
                        onChange={setContributeNote}
                        placeholder="Paycheck allocation, birthday money, etc."
                        disabled={contributing}
                    />
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={closeContribute}
                            disabled={contributing}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 text-slate-300 hover:border-slate-600 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={contributing}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors disabled:opacity-50"
                        >
                            {contributing ? 'Saving...' : 'Add contribution'}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal open={historyOpen} onClose={closeHistory} title="Contribution history">
                <div className="space-y-4">
                    {actionGoal && (
                        <p className="text-sm text-slate-400">
                            Timeline for <span className="text-slate-200">{actionGoal.name}</span>
                        </p>
                    )}
                    {historyLoading ? (
                        <p className="text-sm text-slate-500 py-4 text-center">Loading history...</p>
                    ) : contributions.length === 0 ? (
                        <p className="text-sm text-slate-500 py-4 text-center">
                            No contributions recorded yet.
                        </p>
                    ) : (
                        <ul className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                            {contributions.map((entry) => (
                                <li
                                    key={entry._id}
                                    className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5"
                                >
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-slate-200">
                                            {formatCurrency(
                                                entry.amount,
                                                actionGoal?.currency ?? DEFAULT_CURRENCY
                                            )}
                                        </p>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            {formatContributionDate(entry.contributedAt)}
                                            {entry.type === 'automatic' && ' · Automatic'}
                                            {entry.note && ` · ${entry.note}`}
                                        </p>
                                    </div>
                                    <span
                                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                                            entry.type === 'automatic'
                                                ? 'bg-violet-500/10 border-violet-500/20 text-violet-300'
                                                : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300'
                                        }`}
                                    >
                                        {entry.type === 'automatic' ? 'Auto' : 'Manual'}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </Modal>

            <ConfirmDialog
                open={confirmAction === 'archive'}
                onClose={() => {
                    setConfirmAction(null)
                    setActionGoal(null)
                }}
                onConfirm={handleConfirmAction}
                title="Archive savings goal"
                message={`Archive "${actionGoal?.name ?? 'this goal'}"? It will move to the archived tab.`}
                confirmLabel="Archive"
                loading={actionLoading}
            />

            <ConfirmDialog
                open={confirmAction === 'complete'}
                onClose={() => {
                    setConfirmAction(null)
                    setActionGoal(null)
                }}
                onConfirm={handleConfirmAction}
                title="Mark goal complete"
                message={`Mark "${actionGoal?.name ?? 'this goal'}" as complete?`}
                confirmLabel="Mark complete"
                loading={actionLoading}
            />

            <ConfirmDialog
                open={confirmAction === 'pause'}
                onClose={() => {
                    setConfirmAction(null)
                    setActionGoal(null)
                }}
                onConfirm={handleConfirmAction}
                title="Pause savings goal"
                message={`Pause "${actionGoal?.name ?? 'this goal'}"? Contributions will be blocked until you resume.`}
                confirmLabel="Pause"
                loading={actionLoading}
            />
        </div>
    )
}

export default SavingsGoals
