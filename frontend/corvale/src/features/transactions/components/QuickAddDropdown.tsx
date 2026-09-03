import React, { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { IoChevronDown, IoFlashOutline } from 'react-icons/io5'
import { fromMinorUnits, toMinorUnits } from '@shared/money'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { useWorkspace } from '@/app/providers/useWorkspace'
import { useUser } from '@/app/providers/useUser'
import { useTransactionTemplatesData } from '@features/settings/hooks/useTransactionTemplatesData'
import { useAccountsData } from '@features/accounts/hooks/useAccountsData'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import { getLocalDb } from '@platform/db/localDbInstance'
import { tableInvalidationBus } from '@lib/tableInvalidationBus'
import { Repository } from '@platform/db/repositories/Repository'
import { generateLocalObjectId } from '@platform/db/generateLocalId'
import { recomputeLocalAccountBalance } from '@domain/accountBalances'
import type { ApiResponse, Transaction, TransactionTemplate } from '@lib/types/api'
import type { LocalAccount, LocalTransaction } from '@domain/types'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'
import { formatCurrency } from '@lib/format'
import { buildWorkspaceBodyFields } from '@lib/workspaceScope'

interface QuickAddDropdownProps {
    onApplied?: (transaction: Transaction) => void
    className?: string
}

/** `LocalTransaction` (domain/types.ts) has no `currency` field yet - it round-trips fine through
 * the JSON `data` blob (Repository stores the full doc), this just widens the local type so this
 * component can write it without touching shared infra (mirrors `useAccountsData.ts`'s
 * `LocalAccountRecord` pattern for the same kind of gap). */
type LocalTransactionRecord = LocalTransaction & { currency: string }

const transactionsRepo = new Repository<LocalTransactionRecord>('transactions')
const accountsRepo = new Repository<LocalAccount>('accounts')

const QuickAddDropdown: React.FC<QuickAddDropdownProps> = ({ onApplied, className = '' }) => {
    const { activeWorkspaceId, canEdit } = useWorkspace()
    const { user } = useUser()
    const [open, setOpen] = useState(false)
    const [applyingId, setApplyingId] = useState<string | null>(null)
    const panelRef = useRef<HTMLDivElement>(null)

    const { templates, loading: templatesLoading, refetch: refetchTemplates } = useTransactionTemplatesData()
    const { accounts } = useAccountsData()

    const availableAccountIds = useMemo(
        () => new Set((accounts ?? []).map((account) => account._id)),
        [accounts]
    )

    const visibleTemplates = useMemo(
        () => (templates ?? []).filter((template) => availableAccountIds.has(template.accountId)),
        [templates, availableAccountIds]
    )

    useEffect(() => {
        if (!open) return

        const handleClickOutside = (event: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                setOpen(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [open])

    /**
     * Mirrors `applyTransactionTemplate` in `backend/controllers/transactionTemplateController.ts`:
     * a straight `Transaction` create from the template's fields, posted immediately, no
     * categorization-rule pass (the server doesn't run one for template-apply either). Balance
     * update goes through `recomputeLocalAccountBalance` (Sprint 13.5) rather than an incremental
     * delta, matching how every other local write settles account balances.
     */
    const applyTemplateLocally = async (template: TransactionTemplate): Promise<Transaction> => {
        if (!user) throw new Error('Not authenticated')
        const db = await getLocalDb()
        const account = await accountsRepo.findById(db, template.accountId)
        if (!account) throw new Error('Account not found locally')

        const now = new Date().toISOString()
        const record: LocalTransactionRecord = {
            _id: generateLocalObjectId(),
            updatedAt: now,
            userId: user._id,
            workspaceId: activeWorkspaceId ?? null,
            accountId: template.accountId,
            categoryId: template.categoryId,
            type: template.type,
            status: 'posted',
            // `template.amount` is major units here (`useTransactionTemplatesData`'s `toTemplateView`
            // already applied `fromMinorUnits` for display) - convert back to the local `transactions`
            // table's minor-unit convention, which `recomputeLocalAccountBalance`'s `getBalanceDeltaMajor`
            // (`@shared/money`) requires.
            amount: toMinorUnits(template.amount),
            currency: account.currency,
            title: template.name,
            description: template.description,
            date: now,
            clearedStatus: 'pending',
            tags: template.tags,
            splitTransactionId: null,
        }

        await db.transaction(async (tx) => {
            await transactionsRepo.create(tx, record)
        })
        tableInvalidationBus.publish('transactions')

        const balance = await recomputeLocalAccountBalance(db, template.accountId)
        const updatedAccount: LocalAccount = { ...account, currentBalance: balance }
        await db.exec(`UPDATE accounts SET data = ?, currentBalance = ?, _localUpdatedAt = ? WHERE _id = ?`, [
            JSON.stringify(updatedAccount),
            balance,
            new Date().toISOString(),
            template.accountId,
        ])
        tableInvalidationBus.publish('accounts')

        return {
            _id: record._id,
            userId: record.userId,
            workspaceId: record.workspaceId,
            accountId: record.accountId,
            categoryId: record.categoryId,
            type: record.type,
            status: record.status,
            // Back to major units for the return value - callers expect the same REST-shaped
            // `Transaction.amount` convention this component's server branch produces.
            amount: fromMinorUnits(record.amount),
            currency: record.currency,
            title: record.title,
            description: record.description,
            date: record.date,
            clearedStatus: record.clearedStatus ?? 'pending',
            tags: record.tags,
            splitTransactionId: record.splitTransactionId,
            updatedAt: record.updatedAt,
        }
    }

    const handleApply = async (template: TransactionTemplate) => {
        setApplyingId(template._id)
        try {
            const transaction = isLocalFirstEnabled()
                ? await applyTemplateLocally(template)
                : unwrapApiData(
                      await axiosInstance.post<ApiResponse<Transaction>>(
                          API_PATHS.TRANSACTION_TEMPLATES.APPLY(template._id),
                          buildWorkspaceBodyFields(activeWorkspaceId)
                      )
                  )
            toast.success(`Added ${template.name}`)
            setOpen(false)
            onApplied?.(transaction)
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to apply template'))
        } finally {
            setApplyingId(null)
        }
    }

    if (!canEdit) {
        return null
    }

    return (
        <div ref={panelRef} className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => {
                    setOpen((current) => !current)
                    if (!open) {
                        void refetchTemplates()
                    }
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-accent/30 text-accent hover:bg-accent-subtle transition-colors"
            >
                <IoFlashOutline size={16} />
                Quick add
                <IoChevronDown size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>

            {open && (
                <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-border-subtle bg-surface shadow-lg overflow-hidden">
                    {templatesLoading ? (
                        <p className="px-4 py-3 text-sm text-fg-muted">Loading templates...</p>
                    ) : visibleTemplates.length === 0 ? (
                        <div className="px-4 py-3">
                            <p className="text-sm text-fg-muted">No templates for this workspace.</p>
                            <p className="text-xs text-fg-muted mt-1">
                                Create presets in Settings → Quick-add templates.
                            </p>
                        </div>
                    ) : (
                        <ul className="max-h-72 overflow-y-auto py-1">
                            {visibleTemplates.map((template) => (
                                <li key={template._id}>
                                    <button
                                        type="button"
                                        disabled={applyingId === template._id}
                                        onClick={() => void handleApply(template)}
                                        className="flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left hover:bg-elevated-hover transition-colors disabled:opacity-60"
                                    >
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-fg truncate">{template.name}</p>
                                            <p className="text-xs text-fg-muted capitalize">{template.type}</p>
                                        </div>
                                        <span
                                            className={`text-sm font-medium shrink-0 ${
                                                template.type === 'income' ? 'text-income' : 'text-expense'
                                            }`}
                                        >
                                            {formatCurrency(template.amount)}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    )
}

export default QuickAddDropdown
