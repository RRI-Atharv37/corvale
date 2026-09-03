import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { IoAdd, IoInformationCircleOutline, IoPencil, IoStar, IoStarOutline, IoSwapVertical, IoTrash } from 'react-icons/io5'
import ReconciliationModal from './components/ReconciliationModal'
import PageHeader from '@ui/PageHeader'
import AsyncContent from '@ui/AsyncContent'
import Modal from '@ui/Modal'
import ConfirmDialog from '@ui/ConfirmDialog'
import PaginatedCardList from '@/app/components/PaginatedCardList'
import FormField from '@ui/forms/FormField'
import { usePageSize } from '@/app/hooks/usePaginatedList'
import { useOnlineStatus } from '@platform/offline/useOnlineStatus'
import type { Account, AccountEditFormData, AccountFormData, AccountType } from '@features/accounts/types'
import { getApiErrorMessage } from '@lib/apiError'
import { formatCurrency } from '@lib/format'
import { DEFAULT_CURRENCY, formatCurrencyLabel } from '@lib/currencies'
import CurrencySelect from '@ui/inputs/CurrencySelect'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import { useUser } from '@/app/providers/useUser'
import { useWorkspace } from '@/app/providers/useWorkspace'
import WorkspaceReadOnlyBanner from '@features/workspaces/components/WorkspaceReadOnlyBanner'
import { useAccountsData } from './hooks/useAccountsData'

const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] = [
    { value: 'checking', label: 'Checking' },
    { value: 'cash', label: 'Cash' },
    { value: 'credit', label: 'Credit' },
    { value: 'savings', label: 'Savings' },
]

const todayIso = (): string => new Date().toISOString().slice(0, 10)

const emptyCreateForm = (preferredCurrency = DEFAULT_CURRENCY): AccountFormData => ({
    name: '',
    type: 'checking',
    currency: preferredCurrency,
    openingBalance: '0',
    openingBalanceDate: todayIso(),
    interestRate: '',
    minimumPayment: '',
})

const emptyEditForm = (): AccountEditFormData => ({
    name: '',
    type: 'checking',
    openingBalance: '',
    openingBalanceDate: '',
    interestRate: '',
    minimumPayment: '',
})

const formatAccountType = (type: AccountType): string =>
    ACCOUNT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type

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

const Accounts = () => {
    const { user } = useUser()
    const { canEdit, isPersonal, activeWorkspace } = useWorkspace()
    const preferredCurrency = user?.preferredCurrency ?? DEFAULT_CURRENCY
    const pageSize = usePageSize()
    const [createOpen, setCreateOpen] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const [createForm, setCreateForm] = useState<AccountFormData>(emptyCreateForm)
    const [editForm, setEditForm] = useState<AccountEditFormData>(emptyEditForm)
    const [editingAccount, setEditingAccount] = useState<Account | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [archiveTarget, setArchiveTarget] = useState<Account | null>(null)
    const [archiving, setArchiving] = useState(false)
    const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null)
    const [reconcilingAccount, setReconcilingAccount] = useState<Account | null>(null)

    // Reconciliation (ReconciliationSession creation, cleared-status updates) stays a plain REST
    // flow unconditionally, even when VITE_LOCAL_FIRST is on - it's a whole separate session-based
    // feature (Sprint 12.1) with server-computed statement-vs-book comparison, out of scope for
    // local-first this sprint, same as SavingsGoals' contribute/pause/resume/complete and Recurring's
    // draft actions. Gated on connectivity here rather than left silently broken while offline.
    const online = useOnlineStatus()
    const reconciliationBlocked = isLocalFirstEnabled() && !online

    const {
        accounts,
        loading,
        error,
        refetch,
        createAccount,
        updateAccount,
        archiveAccount,
        setDefaultAccount,
    } = useAccountsData()

    const openCreate = () => {
        setCreateForm(emptyCreateForm(preferredCurrency))
        setCreateOpen(true)
    }

    const closeCreate = () => {
        setCreateOpen(false)
        setCreateForm(emptyCreateForm(preferredCurrency))
    }

    const openEdit = (account: Account) => {
        setEditingAccount(account)
        setEditForm({
            name: account.name,
            type: account.type,
            openingBalance: String(account.openingBalance),
            openingBalanceDate: account.openingBalanceDate
                ? account.openingBalanceDate.slice(0, 10)
                : '',
            interestRate: account.interestRate !== undefined ? String(account.interestRate) : '',
            minimumPayment: account.minimumPayment !== undefined ? String(account.minimumPayment) : '',
        })
        setEditOpen(true)
    }

    const closeEdit = () => {
        setEditOpen(false)
        setEditingAccount(null)
        setEditForm(emptyEditForm())
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!createForm.name.trim()) {
            toast.error('Account name is required')
            return
        }

        const openingBalance = Number(createForm.openingBalance)
        if (isNaN(openingBalance)) {
            toast.error('Opening balance must be a valid number')
            return
        }

        const isCredit = createForm.type === 'credit'
        const interestRate = isCredit && createForm.interestRate !== '' ? Number(createForm.interestRate) : undefined
        const minimumPayment =
            isCredit && createForm.minimumPayment !== '' ? Number(createForm.minimumPayment) : undefined

        if (interestRate !== undefined && isNaN(interestRate)) {
            toast.error('Interest rate must be a valid number')
            return
        }
        if (minimumPayment !== undefined && isNaN(minimumPayment)) {
            toast.error('Minimum payment must be a valid number')
            return
        }

        setSubmitting(true)
        try {
            await createAccount({
                name: createForm.name.trim(),
                type: createForm.type,
                currency: createForm.currency,
                openingBalance,
                openingBalanceDate: createForm.openingBalanceDate || undefined,
                interestRate,
                minimumPayment,
            })
            toast.success('Account created')
            closeCreate()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to create account'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingAccount) return

        if (!editForm.name.trim()) {
            toast.error('Account name is required')
            return
        }

        const isCredit = editForm.type === 'credit'
        const interestRate = isCredit && editForm.interestRate !== '' ? Number(editForm.interestRate) : undefined
        const minimumPayment =
            isCredit && editForm.minimumPayment !== '' ? Number(editForm.minimumPayment) : undefined

        if (interestRate !== undefined && isNaN(interestRate)) {
            toast.error('Interest rate must be a valid number')
            return
        }
        if (minimumPayment !== undefined && isNaN(minimumPayment)) {
            toast.error('Minimum payment must be a valid number')
            return
        }

        const openingBalance = Number(editForm.openingBalance)
        if (editForm.openingBalance !== '' && isNaN(openingBalance)) {
            toast.error('Opening balance must be a valid number')
            return
        }
        const openingBalanceChanged =
            editForm.openingBalance !== '' && openingBalance !== editingAccount.openingBalance
        const currentOpeningDate = editingAccount.openingBalanceDate
            ? editingAccount.openingBalanceDate.slice(0, 10)
            : ''
        const openingBalanceDateChanged = editForm.openingBalanceDate !== currentOpeningDate

        setSubmitting(true)
        try {
            await updateAccount(editingAccount, {
                name: editForm.name.trim(),
                type: editForm.type,
                ...(openingBalanceChanged && { openingBalance }),
                ...(openingBalanceDateChanged && {
                    openingBalanceDate: editForm.openingBalanceDate || null,
                }),
                interestRate,
                minimumPayment,
            })
            toast.success('Account updated')
            closeEdit()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to update account'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleSetDefault = async (account: Account) => {
        if (account.isDefault) return

        setSettingDefaultId(account._id)
        try {
            await setDefaultAccount(account)
            toast.success(`"${account.name}" is now your default account`)
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to set default account'))
        } finally {
            setSettingDefaultId(null)
        }
    }

    const handleArchive = async () => {
        if (!archiveTarget) return

        setArchiving(true)
        try {
            await archiveAccount(archiveTarget)
            toast.success('Account archived')
            setArchiveTarget(null)
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to archive account'))
        } finally {
            setArchiving(false)
        }
    }

    return (
        <div>
            <PageHeader
                title="Accounts"
                description={
                    isPersonal
                        ? 'Manage your checking, savings, and cash accounts'
                        : `Shared accounts in ${activeWorkspace?.name ?? 'workspace'}`
                }
                actions={
                    canEdit ? (
                        <button
                            type="button"
                            onClick={openCreate}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors"
                        >
                            <IoAdd size={18} />
                            Add account
                        </button>
                    ) : undefined
                }
            />

            <WorkspaceReadOnlyBanner />

            <AsyncContent
                loading={loading}
                error={error}
                data={accounts}
                isEmpty={(items) => items.length === 0}
                loadingMessage="Loading accounts..."
                emptyTitle="No accounts yet"
                emptyDescription="Create your first account to start tracking balances."
                onRetry={refetch}
            >
                {(items) => (
                    <>
                        {(user?.exchangeRates && Object.keys(user.exchangeRates).length > 0) &&
                            items.every((account) => account.currency === preferredCurrency) && (
                                <div className="mb-4 flex items-start gap-2 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2.5 text-xs text-text-muted">
                                    <IoInformationCircleOutline size={16} className="mt-0.5 shrink-0" />
                                    <p>
                                        All of your accounts are already in {formatCurrencyLabel(preferredCurrency)}
                                        , your default currency, so there&apos;s nothing to convert yet. Your saved
                                        exchange rates will show up as a converted amount here once you add an
                                        account in a different currency.
                                    </p>
                                </div>
                            )}
                    <PaginatedCardList items={items} pageSize={pageSize}>
                        {(paginatedItems) => (
                    <div className="space-y-3">
                        {paginatedItems.map((account) => (
                            <div key={account._id} className="card flex items-center justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="text-sm font-medium text-fg truncate">
                                            {account.name}
                                        </p>
                                        {account.isDefault && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-accent-subtle border border-accent/30 px-2 py-0.5 text-[11px] font-medium text-accent">
                                                <IoStar size={12} />
                                                Default
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-fg-muted mt-0.5">
                                        {formatAccountType(account.type)} · {formatCurrencyLabel(account.currency)}
                                        {account.type === 'credit' && account.interestRate !== undefined && (
                                            <> · {account.interestRate}% APR</>
                                        )}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <div className="text-right">
                                        <p className="text-sm font-semibold text-accent">
                                            {formatCurrency(account.currentBalance, account.currency)}
                                        </p>
                                        <p className="text-[11px] text-fg-muted">Current balance</p>
                                        {account.currency !== preferredCurrency &&
                                            account.convertedBalance !== undefined &&
                                            (account.hasExchangeRate ? (
                                                <p className="text-[11px] text-fg-muted">
                                                    ≈ {formatCurrency(account.convertedBalance, preferredCurrency)}
                                                </p>
                                            ) : (
                                                <p className="text-[11px] text-warning">
                                                    No {account.currency}→{preferredCurrency} rate set
                                                </p>
                                            ))}
                                    </div>
                                    {!account.isDefault && isPersonal && canEdit && (
                                        <button
                                            type="button"
                                            onClick={() => handleSetDefault(account)}
                                            disabled={settingDefaultId === account._id}
                                            className="p-1.5 text-fg-muted hover:text-warning transition-colors disabled:opacity-50"
                                            aria-label="Set as default account"
                                            title="Set as default"
                                        >
                                            <IoStarOutline size={16} />
                                        </button>
                                    )}
                                    {canEdit && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => setReconcilingAccount(account)}
                                                disabled={reconciliationBlocked}
                                                className="p-1.5 text-fg-muted hover:text-accent transition-colors disabled:opacity-50"
                                                aria-label="Reconcile account"
                                                title={reconciliationBlocked ? 'Requires an internet connection' : 'Reconcile'}
                                            >
                                                <IoSwapVertical size={16} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => openEdit(account)}
                                                className="p-1.5 text-fg-muted hover:text-accent transition-colors"
                                                aria-label="Edit account"
                                            >
                                                <IoPencil size={16} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setArchiveTarget(account)}
                                                className="p-1.5 text-fg-muted hover:text-expense transition-colors"
                                                aria-label="Archive account"
                                            >
                                                <IoTrash size={16} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                        )}
                    </PaginatedCardList>
                    </>
                )}
            </AsyncContent>

            <Modal open={createOpen} onClose={closeCreate} title="Add account">
                <form onSubmit={handleCreate} className="space-y-4">
                    <FormField
                        label="Name"
                        value={createForm.name}
                        onChange={(v) => setCreateForm((f) => ({ ...f, name: v }))}
                        placeholder="Main checking, Cash wallet, etc."
                        required
                        disabled={submitting}
                    />
                    <SelectField
                        label="Type"
                        value={createForm.type}
                        onChange={(v) =>
                            setCreateForm((f) => ({ ...f, type: v as AccountType }))
                        }
                        options={ACCOUNT_TYPE_OPTIONS}
                        required
                        disabled={submitting}
                    />
                    {createForm.type === 'credit' && (
                        <div className="grid grid-cols-2 gap-3">
                            <FormField
                                label="Interest rate (APR %)"
                                type="number"
                                value={createForm.interestRate}
                                onChange={(v) => setCreateForm((f) => ({ ...f, interestRate: v }))}
                                placeholder="24.99"
                                disabled={submitting}
                                step="0.01"
                                min="0"
                            />
                            <FormField
                                label="Minimum payment"
                                type="number"
                                value={createForm.minimumPayment}
                                onChange={(v) => setCreateForm((f) => ({ ...f, minimumPayment: v }))}
                                placeholder="35.00"
                                disabled={submitting}
                                step="0.01"
                                min="0"
                            />
                        </div>
                    )}
                    <CurrencySelect
                        value={createForm.currency}
                        onChange={(v) => setCreateForm((f) => ({ ...f, currency: v }))}
                        required
                        disabled={submitting}
                    />
                    <FormField
                        label="Current balance"
                        type="number"
                        value={createForm.openingBalance}
                        onChange={(v) => setCreateForm((f) => ({ ...f, openingBalance: v }))}
                        placeholder="0.00"
                        required
                        disabled={submitting}
                        step="0.01"
                    />
                    <FormField
                        label="Balance as of"
                        type="date"
                        value={createForm.openingBalanceDate}
                        onChange={(v) => setCreateForm((f) => ({ ...f, openingBalanceDate: v }))}
                        max={todayIso()}
                        disabled={submitting}
                    />
                    <p className="text-[12px] text-fg-muted -mt-2">
                        Enter the balance as it stands on this date. Transactions dated earlier
                        won&apos;t change it, so importing or back-filling older history stays safe.
                    </p>
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
                            {submitting ? 'Creating...' : 'Create account'}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal open={editOpen} onClose={closeEdit} title="Edit account">
                <form onSubmit={handleEdit} className="space-y-4">
                    <FormField
                        label="Name"
                        value={editForm.name}
                        onChange={(v) => setEditForm((f) => ({ ...f, name: v }))}
                        placeholder="Account name"
                        required
                        disabled={submitting}
                    />
                    <SelectField
                        label="Type"
                        value={editForm.type}
                        onChange={(v) => setEditForm((f) => ({ ...f, type: v as AccountType }))}
                        options={ACCOUNT_TYPE_OPTIONS}
                        required
                        disabled={submitting}
                    />
                    {editForm.type === 'credit' && (
                        <div className="grid grid-cols-2 gap-3">
                            <FormField
                                label="Interest rate (APR %)"
                                type="number"
                                value={editForm.interestRate}
                                onChange={(v) => setEditForm((f) => ({ ...f, interestRate: v }))}
                                placeholder="24.99"
                                disabled={submitting}
                                step="0.01"
                                min="0"
                            />
                            <FormField
                                label="Minimum payment"
                                type="number"
                                value={editForm.minimumPayment}
                                onChange={(v) => setEditForm((f) => ({ ...f, minimumPayment: v }))}
                                placeholder="35.00"
                                disabled={submitting}
                                step="0.01"
                                min="0"
                            />
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <FormField
                            label="Opening balance"
                            type="number"
                            value={editForm.openingBalance}
                            onChange={(v) => setEditForm((f) => ({ ...f, openingBalance: v }))}
                            placeholder="0.00"
                            disabled={submitting}
                            step="0.01"
                        />
                        <FormField
                            label="Balance as of"
                            type="date"
                            value={editForm.openingBalanceDate}
                            onChange={(v) => setEditForm((f) => ({ ...f, openingBalanceDate: v }))}
                            max={todayIso()}
                            disabled={submitting}
                        />
                    </div>
                    <p className="text-[12px] text-fg-muted -mt-2">
                        Changing either value recalculates this account&apos;s current balance from
                        its transactions. Leave &ldquo;balance as of&rdquo; empty to count every
                        transaction regardless of date.
                    </p>
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
                title="Archive account"
                message={`Are you sure you want to archive "${archiveTarget?.name}"? It will be hidden from your account list.`}
                confirmLabel="Archive"
                loading={archiving}
            />

            {reconcilingAccount && (
                <ReconciliationModal
                    account={reconcilingAccount}
                    open={reconcilingAccount !== null}
                    onClose={() => setReconcilingAccount(null)}
                    onReconciled={refetch}
                />
            )}
        </div>
    )
}

export default Accounts
