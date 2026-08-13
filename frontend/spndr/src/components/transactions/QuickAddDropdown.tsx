import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { IoChevronDown, IoFlashOutline } from 'react-icons/io5'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useWorkspace } from '../../hooks/useWorkspace'
import type { Account, ApiResponse, Transaction, TransactionTemplate } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatCurrency } from '../../utils/format'
import { buildWorkspaceBodyFields, buildWorkspaceQueryParams } from '../../utils/workspaceScope'

interface QuickAddDropdownProps {
    onApplied?: (transaction: Transaction) => void
    className?: string
}

const QuickAddDropdown: React.FC<QuickAddDropdownProps> = ({ onApplied, className = '' }) => {
    const { activeWorkspaceId, canEdit } = useWorkspace()
    const [open, setOpen] = useState(false)
    const [applyingId, setApplyingId] = useState<string | null>(null)
    const panelRef = useRef<HTMLDivElement>(null)

    const fetchTemplates = useCallback(async (): Promise<TransactionTemplate[]> => {
        const response = await axiosInstance.get<ApiResponse<TransactionTemplate[]>>(
            API_PATHS.TRANSACTION_TEMPLATES.GET_ALL
        )
        return unwrapApiData(response)
    }, [])

    const fetchAccounts = useCallback(async (): Promise<Account[]> => {
        const response = await axiosInstance.get<ApiResponse<Account[]>>(API_PATHS.ACCOUNTS.GET_ALL, {
            params: buildWorkspaceQueryParams(activeWorkspaceId),
        })
        return unwrapApiData(response)
    }, [activeWorkspaceId])

    const {
        data: templates,
        loading: templatesLoading,
        refetch: refetchTemplates,
    } = useAsyncData(fetchTemplates, [fetchTemplates])

    const { data: accounts } = useAsyncData(fetchAccounts, [fetchAccounts])

    const availableAccountIds = useMemo(
        () => new Set((accounts ?? []).filter((account) => !account.isArchived).map((account) => account._id)),
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

    const handleApply = async (template: TransactionTemplate) => {
        setApplyingId(template._id)
        try {
            const response = await axiosInstance.post<ApiResponse<Transaction>>(
                API_PATHS.TRANSACTION_TEMPLATES.APPLY(template._id),
                buildWorkspaceBodyFields(activeWorkspaceId)
            )
            const transaction = unwrapApiData(response)
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
