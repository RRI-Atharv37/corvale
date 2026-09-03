import React, { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
    IoAdd,
    IoArrowBack,
    IoFlashOutline,
    IoPencil,
    IoPlayOutline,
    IoTrash,
} from 'react-icons/io5'
import PageHeader from '@ui/PageHeader'
import AsyncContent from '@ui/AsyncContent'
import Modal from '@ui/Modal'
import ConfirmDialog from '@ui/ConfirmDialog'
import FormField from '@ui/forms/FormField'
import CategoryPicker from './components/CategoryPicker'
import TagPicker from '@features/tags/components/TagPicker'
import TagChip from '@features/tags/components/TagChip'
import { useCategorizationRulesData, type CategorizationRuleInput } from './hooks/useCategorizationRulesData'
import { useAccountsData } from '@features/accounts/hooks/useAccountsData'
import { useCategoriesData } from './hooks/useCategoriesData'
import { useTagsData } from '@features/tags/hooks/useTagsData'
import type {
    Account,
    CategorizationMatchType,
    CategorizationRule,
    CategorizationRuleFormData,
    CategorizationRuleTestResult,
} from '@lib/types/api'
import { getApiErrorMessage } from '@lib/apiError'
import { formatCurrency } from '@lib/format'

const MATCH_TYPE_OPTIONS: { value: CategorizationMatchType; label: string }[] = [
    { value: 'description_contains', label: 'Description contains' },
    { value: 'description_equals', label: 'Description equals' },
    { value: 'amount_range', label: 'Amount range' },
    { value: 'account_id', label: 'Account' },
]

const emptyForm = (): CategorizationRuleFormData => ({
    name: '',
    matchType: 'description_contains',
    matchValue: '',
    amountMin: '',
    amountMax: '',
    accountId: '',
    categoryId: '',
    tags: [],
    priority: '0',
    isActive: true,
})

const ruleToForm = (rule: CategorizationRule): CategorizationRuleFormData => ({
    name: rule.name,
    matchType: rule.matchType,
    matchValue: rule.matchValue ?? '',
    amountMin: rule.amountMin !== undefined ? String(rule.amountMin) : '',
    amountMax: rule.amountMax !== undefined ? String(rule.amountMax) : '',
    accountId: rule.accountId ?? '',
    categoryId: rule.categoryId,
    tags: rule.tags ?? [],
    priority: String(rule.priority),
    isActive: rule.isActive,
})

const buildMatchSummary = (rule: CategorizationRule, accounts: Account[]): string => {
    switch (rule.matchType) {
        case 'description_contains':
            return `Contains "${rule.matchValue ?? ''}"`
        case 'description_equals':
            return `Equals "${rule.matchValue ?? ''}"`
        case 'amount_range': {
            const min = rule.amountMin
            const max = rule.amountMax
            if (min !== undefined && max !== undefined) {
                return `${formatCurrency(min)} – ${formatCurrency(max)}`
            }
            if (min !== undefined) {
                return `≥ ${formatCurrency(min)}`
            }
            if (max !== undefined) {
                return `≤ ${formatCurrency(max)}`
            }
            return 'Amount range'
        }
        case 'account_id': {
            const account = accounts.find((item) => item._id === rule.accountId)
            return account ? `Account: ${account.name}` : 'Specific account'
        }
        default:
            return rule.matchType
    }
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

const buildPayload = (form: CategorizationRuleFormData): CategorizationRuleInput => {
    const payload: CategorizationRuleInput = {
        name: form.name.trim(),
        matchType: form.matchType,
        categoryId: form.categoryId,
        tags: form.tags,
        priority: Number(form.priority) || 0,
        isActive: form.isActive,
    }

    if (form.matchType === 'description_contains' || form.matchType === 'description_equals') {
        payload.matchValue = form.matchValue.trim()
    }

    if (form.matchType === 'amount_range') {
        if (form.amountMin.trim()) payload.amountMin = Number(form.amountMin)
        if (form.amountMax.trim()) payload.amountMax = Number(form.amountMax)
    }

    if (form.matchType === 'account_id') {
        payload.accountId = form.accountId
    }

    return payload
}

const CategorizationRules = () => {
    const [createOpen, setCreateOpen] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const [createForm, setCreateForm] = useState<CategorizationRuleFormData>(emptyForm())
    const [editForm, setEditForm] = useState<CategorizationRuleFormData>(emptyForm())
    const [editingRule, setEditingRule] = useState<CategorizationRule | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<CategorizationRule | null>(null)
    const [deleting, setDeleting] = useState(false)
    const [bulkApplying, setBulkApplying] = useState(false)
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<CategorizationRuleTestResult | null>(null)
    const [testForm, setTestForm] = useState({
        title: '',
        description: '',
        amount: '',
        accountId: '',
    })

    const {
        rules,
        loading,
        error,
        refetch,
        createRule,
        updateRule,
        deleteRule,
        toggleRuleActive: toggleRuleActiveRemote,
        bulkApply,
        testRule,
    } = useCategorizationRulesData()
    const { categories } = useCategoriesData()
    const { accounts } = useAccountsData()
    const { tags } = useTagsData()

    const resolveCategoryName = useCallback(
        (categoryId: string): string => {
            if (!categories) return 'Category'
            const match =
                categories.masters.find((item) => item._id === categoryId) ??
                categories.userCategories.find((item) => item._id === categoryId)
            return match?.name ?? 'Category'
        },
        [categories]
    )

    const accountOptions = useMemo(
        () =>
            (accounts ?? [])
                .filter((account) => !account.isArchived)
                .map((account) => ({ value: account._id, label: account.name })),
        [accounts]
    )

    const openCreate = () => {
        setCreateForm(emptyForm())
        setCreateOpen(true)
    }

    const closeCreate = () => {
        setCreateOpen(false)
        setCreateForm(emptyForm())
    }

    const openEdit = (rule: CategorizationRule) => {
        setEditingRule(rule)
        setEditForm(ruleToForm(rule))
        setEditOpen(true)
    }

    const closeEdit = () => {
        setEditOpen(false)
        setEditingRule(null)
        setEditForm(emptyForm())
    }

    const validateForm = (form: CategorizationRuleFormData): string | null => {
        if (!form.name.trim()) return 'Rule name is required'
        if (!form.categoryId) return 'Target category is required'

        if (
            (form.matchType === 'description_contains' ||
                form.matchType === 'description_equals') &&
            !form.matchValue.trim()
        ) {
            return 'Match text is required'
        }

        if (form.matchType === 'amount_range' && !form.amountMin.trim() && !form.amountMax.trim()) {
            return 'Enter at least a minimum or maximum amount'
        }

        if (form.matchType === 'account_id' && !form.accountId) {
            return 'Select an account'
        }

        return null
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        const validationError = validateForm(createForm)
        if (validationError) {
            toast.error(validationError)
            return
        }

        setSubmitting(true)
        try {
            await createRule(buildPayload(createForm))
            toast.success('Rule created')
            closeCreate()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to create rule'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingRule) return

        const validationError = validateForm(editForm)
        if (validationError) {
            toast.error(validationError)
            return
        }

        setSubmitting(true)
        try {
            await updateRule(editingRule, buildPayload(editForm))
            toast.success('Rule updated')
            closeEdit()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to update rule'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async () => {
        if (!deleteTarget) return

        setDeleting(true)
        try {
            await deleteRule(deleteTarget)
            toast.success('Rule deleted')
            setDeleteTarget(null)
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to delete rule'))
        } finally {
            setDeleting(false)
        }
    }

    const handleBulkApply = async () => {
        setBulkApplying(true)
        try {
            const result = await bulkApply()
            toast.success(result.message)
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to apply rules'))
        } finally {
            setBulkApplying(false)
        }
    }

    const handleTest = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!testForm.amount.trim() || !testForm.accountId) {
            toast.error('Sample amount and account are required')
            return
        }

        setTesting(true)
        setTestResult(null)
        try {
            const result = await testRule({
                title: testForm.title.trim(),
                description: testForm.description.trim() || undefined,
                amount: Number(testForm.amount),
                accountId: testForm.accountId,
                type: 'expense',
            })
            setTestResult(result)
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to test rules'))
        } finally {
            setTesting(false)
        }
    }

    const toggleRuleActive = async (rule: CategorizationRule) => {
        try {
            await toggleRuleActiveRemote(rule)
            toast.success(rule.isActive ? 'Rule paused' : 'Rule activated')
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to update rule'))
        }
    }

    const renderMatchFields = (
        form: CategorizationRuleFormData,
        setForm: React.Dispatch<React.SetStateAction<CategorizationRuleFormData>>,
        disabled: boolean
    ) => {
        switch (form.matchType) {
            case 'description_contains':
            case 'description_equals':
                return (
                    <FormField
                        label="Match text"
                        value={form.matchValue}
                        onChange={(v) => setForm((current) => ({ ...current, matchValue: v }))}
                        placeholder="e.g. Starbucks, Netflix"
                        required
                        disabled={disabled}
                    />
                )
            case 'amount_range':
                return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FormField
                            label="Minimum amount"
                            type="number"
                            value={form.amountMin}
                            onChange={(v) => setForm((current) => ({ ...current, amountMin: v }))}
                            placeholder="0.00"
                            disabled={disabled}
                        />
                        <FormField
                            label="Maximum amount"
                            type="number"
                            value={form.amountMax}
                            onChange={(v) => setForm((current) => ({ ...current, amountMax: v }))}
                            placeholder="0.00"
                            disabled={disabled}
                        />
                    </div>
                )
            case 'account_id':
                return (
                    <SelectField
                        label="Account"
                        value={form.accountId}
                        onChange={(v) => setForm((current) => ({ ...current, accountId: v }))}
                        options={[{ value: '', label: 'Select account' }, ...accountOptions]}
                        required
                        disabled={disabled}
                    />
                )
            default:
                return null
        }
    }

    const renderRuleForm = (
        form: CategorizationRuleFormData,
        setForm: React.Dispatch<React.SetStateAction<CategorizationRuleFormData>>,
        onSubmit: (e: React.FormEvent) => void,
        onCancel: () => void,
        submitLabel: string
    ) => (
        <form onSubmit={onSubmit} className="space-y-4">
            <FormField
                label="Rule name"
                value={form.name}
                onChange={(v) => setForm((current) => ({ ...current, name: v }))}
                placeholder="e.g. Coffee shops"
                required
                disabled={submitting}
            />

            <SelectField
                label="Match type"
                value={form.matchType}
                onChange={(v) =>
                    setForm((current) => ({
                        ...current,
                        matchType: v as CategorizationMatchType,
                    }))
                }
                options={MATCH_TYPE_OPTIONS}
                required
                disabled={submitting}
            />

            {renderMatchFields(form, setForm, submitting)}

            <CategoryPicker
                label="Assign category"
                value={form.categoryId}
                onChange={(v) => setForm((current) => ({ ...current, categoryId: v }))}
                required
                disabled={submitting}
                categoriesData={categories ?? undefined}
            />

            <TagPicker
                label="Assign tags (optional)"
                value={form.tags}
                onChange={(v) => setForm((current) => ({ ...current, tags: v }))}
                disabled={submitting}
                tagsData={tags ?? undefined}
            />

            <FormField
                label="Priority"
                type="number"
                value={form.priority}
                onChange={(v) => setForm((current) => ({ ...current, priority: v }))}
                placeholder="Higher runs first"
                disabled={submitting}
            />

            <label className="flex items-center gap-2 text-sm text-fg-secondary">
                <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm((current) => ({ ...current, isActive: e.target.checked }))}
                    disabled={submitting}
                    className="rounded border-border"
                />
                Active
            </label>

            <div className="flex justify-end gap-3 pt-2">
                <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
                    Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                    {submitting ? 'Saving...' : submitLabel}
                </button>
            </div>
        </form>
    )

    return (
        <div>
            <PageHeader
                title="Auto-categorization rules"
                description="Automatically assign categories and tags when transactions match your criteria"
                actions={
                    <div className="flex flex-wrap gap-2">
                        <Link to="/categories" className="btn-secondary inline-flex items-center gap-2">
                            <IoArrowBack size={16} />
                            Categories
                        </Link>
                        <button
                            type="button"
                            className="btn-secondary inline-flex items-center gap-2"
                            onClick={handleBulkApply}
                            disabled={bulkApplying || !rules?.length}
                        >
                            <IoFlashOutline size={16} />
                            {bulkApplying ? 'Applying...' : 'Apply to existing'}
                        </button>
                        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openCreate}>
                            <IoAdd size={18} />
                            Create rule
                        </button>
                    </div>
                }
            />

            <AsyncContent
                loading={loading}
                error={error}
                data={rules}
                isEmpty={(items) => items.length === 0}
                loadingMessage="Loading rules..."
                emptyTitle="No rules yet"
                emptyDescription="Create a rule to auto-assign categories when new transactions match."
                emptyAction={
                    <button
                        type="button"
                        className="btn-primary inline-flex items-center gap-2"
                        onClick={openCreate}
                    >
                        <IoAdd size={18} />
                        Create your first rule
                    </button>
                }
                onRetry={refetch}
            >
                {(items) => (
                    <div className="space-y-3">
                        {items.map((rule) => (
                            <div
                                key={rule._id}
                                className={[
                                    'card p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4',
                                    !rule.isActive ? 'opacity-60' : '',
                                ].join(' ')}
                            >
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="font-medium text-text-primary">{rule.name}</h3>
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-elevated text-text-muted">
                                            Priority {rule.priority}
                                        </span>
                                        {!rule.isActive && (
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-elevated text-text-muted">
                                                Paused
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-text-muted mt-1">
                                        {buildMatchSummary(rule, accounts ?? [])}
                                    </p>
                                    <p className="text-sm text-text-muted mt-1">
                                        → {resolveCategoryName(rule.categoryId)}
                                    </p>
                                    {rule.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                            {rule.tags.map((tag) => (
                                                <TagChip key={tag} name={tag} color="#6b7280" />
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        type="button"
                                        className="btn-secondary text-sm"
                                        onClick={() => toggleRuleActive(rule)}
                                    >
                                        {rule.isActive ? 'Pause' : 'Activate'}
                                    </button>
                                    <button
                                        type="button"
                                        className="icon-btn"
                                        onClick={() => openEdit(rule)}
                                        aria-label="Edit rule"
                                    >
                                        <IoPencil size={16} />
                                    </button>
                                    <button
                                        type="button"
                                        className="icon-btn text-expense"
                                        onClick={() => setDeleteTarget(rule)}
                                        aria-label="Delete rule"
                                    >
                                        <IoTrash size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </AsyncContent>

            <section className="card p-6 mt-8">
                <div className="flex items-center gap-2 mb-4">
                    <IoPlayOutline size={18} className="text-accent" />
                    <h2 className="font-display text-lg font-semibold text-text-primary">Test rules</h2>
                </div>
                <p className="text-sm text-text-muted mb-4">
                    Preview which rule would match a sample transaction before saving real data.
                </p>
                <form onSubmit={handleTest} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                        label="Title"
                        value={testForm.title}
                        onChange={(v) => setTestForm((current) => ({ ...current, title: v }))}
                        placeholder="Merchant or payee"
                        disabled={testing}
                    />
                    <FormField
                        label="Description"
                        value={testForm.description}
                        onChange={(v) => setTestForm((current) => ({ ...current, description: v }))}
                        placeholder="Optional memo"
                        disabled={testing}
                    />
                    <FormField
                        label="Amount"
                        type="number"
                        value={testForm.amount}
                        onChange={(v) => setTestForm((current) => ({ ...current, amount: v }))}
                        placeholder="0.00"
                        required
                        disabled={testing}
                    />
                    <SelectField
                        label="Account"
                        value={testForm.accountId}
                        onChange={(v) => setTestForm((current) => ({ ...current, accountId: v }))}
                        options={[{ value: '', label: 'Select account' }, ...accountOptions]}
                        required
                        disabled={testing}
                    />
                    <div className="md:col-span-2">
                        <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={testing}>
                            <IoPlayOutline size={16} />
                            {testing ? 'Testing...' : 'Run test'}
                        </button>
                    </div>
                </form>

                {testResult && (
                    <div
                        className={[
                            'mt-4 rounded-lg border px-4 py-3 text-sm',
                            testResult.matched
                                ? 'border-accent/40 bg-accent/10 text-text-primary'
                                : 'border-border bg-elevated text-text-muted',
                        ].join(' ')}
                    >
                        {testResult.matched ? (
                            <div>
                                <p className="font-medium">Matched: {testResult.ruleName}</p>
                                <p className="mt-1">
                                    Category: {resolveCategoryName(testResult.categoryId ?? '')}
                                </p>
                                {testResult.tags && testResult.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {testResult.tags.map((tag) => (
                                            <TagChip key={tag} name={tag} color="#6b7280" />
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p>{testResult.message ?? 'No active rule matched the sample transaction'}</p>
                        )}
                    </div>
                )}
            </section>

            <Modal open={createOpen} onClose={closeCreate} title="Create rule">
                {renderRuleForm(createForm, setCreateForm, handleCreate, closeCreate, 'Create rule')}
            </Modal>

            <Modal open={editOpen} onClose={closeEdit} title="Edit rule">
                {renderRuleForm(editForm, setEditForm, handleEdit, closeEdit, 'Save changes')}
            </Modal>

            <ConfirmDialog
                open={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDelete}
                title="Delete rule"
                message={`Delete "${deleteTarget?.name ?? 'this rule'}"? Existing transactions will keep their current categories.`}
                confirmLabel="Delete"
                loading={deleting}
            />
        </div>
    )
}

export default CategorizationRules
