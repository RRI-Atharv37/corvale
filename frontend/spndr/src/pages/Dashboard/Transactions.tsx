import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
    IoAdd,
    IoDownload,
    IoPencil,
    IoSearch,
    IoSwapHorizontal,
    IoTrash,
    IoCloudUploadOutline,
    IoCopyOutline,
} from 'react-icons/io5'
import { Link, useSearchParams } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import Modal from '../../components/ui/Modal'
import Pagination from '../../components/ui/Pagination'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import FormField, { TextAreaField } from '../../components/forms/FormField'
import CategoryPicker from '../../components/categories/CategoryPicker'
import TagPicker from '../../components/tags/TagPicker'
import TagChip from '../../components/tags/TagChip'
import AccountPicker from '../../components/accounts/AccountPicker'
import ReceiptAttachments from '../../components/transactions/ReceiptAttachments'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { usePageSize } from '../../hooks/usePaginatedList'
import { useUser } from '../../hooks/useUser'
import { useAccountsData } from './hooks/useAccountsData'
import { useCategoriesData } from './hooks/useCategoriesData'
import { useTagsData } from './hooks/useTagsData'
import {
    useTransactionsData,
    type SortField,
    type SortOrder,
    type StatusFilter,
    type TypeFilter,
} from './hooks/useTransactionsData'
import type {
    ApiResponse,
    Receipt,
    SplitLineFormData,
    Transaction,
    TransactionFormData,
    TransactionType,
    TransferFormData,
} from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatCurrency, formatDisplayDate, toDateInputValue } from '../../utils/format'
import { attachReceiptToTransaction, uploadReceipt } from '../../utils/receiptApi'
import { useWorkspace } from '../../hooks/useWorkspace'
import WorkspaceReadOnlyBanner from '../../components/workspaces/WorkspaceReadOnlyBanner'
import QuickAddDropdown from '../../components/transactions/QuickAddDropdown'
import { buildWorkspaceBodyFields, buildWorkspaceQueryParams } from '../../utils/workspaceScope'
import {
    buildExportFilename,
    downloadExportBlob,
    ensureExportBlob,
    EXPORT_FORMAT_OPTIONS,
    TRANSACTION_EXPORT_TYPE_OPTIONS,
    type ExportFormat,
    type TransactionExportType,
} from '../../utils/downloadExport'

const emptySplitLine = (): SplitLineFormData => ({ categoryId: '', amount: '' })

const emptyForm = (type: 'income' | 'expense' = 'expense'): TransactionFormData => ({
    type,
    title: '',
    amount: '',
    date: toDateInputValue(new Date()),
    accountId: '',
    categoryId: '',
    description: '',
    source: '',
    paymentMethod: '',
    tags: [],
    splitEnabled: false,
    splits: [emptySplitLine(), emptySplitLine()],
})

const emptyTransferForm = (): TransferFormData => ({
    title: '',
    amount: '',
    date: toDateInputValue(new Date()),
    fromAccountId: '',
    toAccountId: '',
    description: '',
})

const TYPE_TABS: { value: TypeFilter; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'income', label: 'Income' },
    { value: 'expense', label: 'Expense' },
    { value: 'transfer', label: 'Transfer' },
]

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'posted', label: 'Posted' },
    { value: 'draft', label: 'Draft' },
]

const SORT_OPTIONS: { value: SortField; label: string }[] = [
    { value: 'date', label: 'Date' },
    { value: 'amount', label: 'Amount' },
    { value: 'category', label: 'Category' },
]

const transactionUserLabel = (type: TransactionType, name: string): string => {
    if (type === 'income') return `Received by ${name}`
    if (type === 'expense') return `Paid by ${name}`
    return `By ${name}`
}

const Transactions = () => {
    const { activeWorkspaceId, canEdit, isPersonal, activeWorkspace } = useWorkspace()
    const { user } = useUser()
    const [searchParams, setSearchParams] = useSearchParams()
    const pageSize = usePageSize()

    const initialType = (searchParams.get('type') as TypeFilter) || ''
    const [page, setPage] = useState(1)
    const [typeFilter, setTypeFilter] = useState<TypeFilter>(
        initialType === 'income' || initialType === 'expense' || initialType === 'transfer'
            ? initialType
            : ''
    )
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
    const [searchInput, setSearchInput] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [dateFilterActive, setDateFilterActive] = useState(false)
    const [sortBy, setSortBy] = useState<SortField>('date')
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
    const [tagFilter, setTagFilter] = useState<string[]>([])

    const [formOpen, setFormOpen] = useState(false)
    const [transferOpen, setTransferOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState<TransactionFormData>(emptyForm())
    const [transferForm, setTransferForm] = useState<TransferFormData>(emptyTransferForm())
    const [submitting, setSubmitting] = useState(false)
    const [transferSubmitting, setTransferSubmitting] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null)
    const [deleting, setDeleting] = useState(false)
    const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
    const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false)
    const [bulkCategoryId, setBulkCategoryId] = useState('')
    const [bulkSubmitting, setBulkSubmitting] = useState(false)
    const [attachedReceipts, setAttachedReceipts] = useState<Receipt[]>([])
    const [pendingReceiptFiles, setPendingReceiptFiles] = useState<File[]>([])
    const [exportType, setExportType] = useState<TransactionExportType>('both')
    const [exportFormat, setExportFormat] = useState<ExportFormat>('csv')
    const [exportStartDate, setExportStartDate] = useState('')
    const [exportEndDate, setExportEndDate] = useState('')
    const [exporting, setExporting] = useState(false)
    const [advancedOpen, setAdvancedOpen] = useState(false)

    const accountsData = useAccountsData()
    const categoriesData = useCategoriesData()
    const tagsData = useTagsData()

    const lookups = useMemo(() => {
        if (!accountsData.accounts || !categoriesData.categories || !tagsData.tags) return null
        return {
            accounts: accountsData.accounts,
            categories: categoriesData.categories,
            tags: tagsData.tags,
        }
    }, [accountsData.accounts, categoriesData.categories, tagsData.tags])

    const refetchLookups = useCallback(async () => {
        await Promise.all([accountsData.refetch(), categoriesData.refetch(), tagsData.refetch()])
    }, [accountsData, categoriesData, tagsData])

    const categoryNameById = useMemo(() => {
        const map = new Map<string, string>()
        if (!lookups) return map
        for (const master of lookups.categories.masters) {
            map.set(master._id, master.name)
        }
        for (const sub of lookups.categories.userCategories) {
            map.set(sub._id, sub.name)
        }
        return map
    }, [lookups])

    const accountNameById = useMemo(() => {
        const map = new Map<string, string>()
        if (!lookups) return map
        for (const account of lookups.accounts) {
            map.set(account._id, account.name)
        }
        return map
    }, [lookups])

    const tagColorByName = useMemo(() => {
        const map = new Map<string, string>()
        if (!lookups) return map
        for (const tag of lookups.tags) {
            const color = tag.color ?? '#6b7280'
            map.set(tag.name, color)
            map.set(tag.name.toLowerCase(), color)
        }
        return map
    }, [lookups])

    const incomeMasterId = useMemo(
        () => lookups?.categories.masters.find((m) => m.name === 'Income')?._id,
        [lookups]
    )

    const setTypeFilterWithUrl = (value: TypeFilter) => {
        setTypeFilter(value)
        setPage(1)
        const next = new URLSearchParams(searchParams)
        if (value) next.set('type', value)
        else next.delete('type')
        setSearchParams(next, { replace: true })
    }

    const defaultAccountId = useMemo(
        () =>
            lookups?.accounts.find((a) => !a.isArchived && a.isDefault)?._id ??
            lookups?.accounts.find((a) => !a.isArchived)?._id ??
            '',
        [lookups]
    )

    useEffect(() => {
        setPage(1)
        setSelectedIds([])
    }, [pageSize, activeWorkspaceId, tagFilter])

    const {
        data,
        loading,
        error,
        refetch,
        onPageChange,
        createTransaction,
        updateTransaction,
        deleteTransaction,
        duplicateTransaction,
        createTransfer,
        bulkDeleteTransactions,
        bulkChangeCategory,
    } = useTransactionsData({
        page,
        setPage,
        pageSize,
        typeFilter,
        statusFilter,
        tagFilter,
        searchQuery,
        dateFilterActive,
        startDate,
        endDate,
        sortBy,
        sortOrder,
        activeWorkspaceId,
        timezone: user?.timezone ?? 'UTC',
    })

    const openCreate = (type: 'income' | 'expense' = typeFilter === 'income' ? 'income' : 'expense') => {
        setEditingId(null)
        setAttachedReceipts([])
        setPendingReceiptFiles([])
        setForm({
            ...emptyForm(type),
            accountId: defaultAccountId,
        })
        setFormOpen(true)
    }

    const openTransfer = () => {
        const accounts = lookups?.accounts.filter((a) => !a.isArchived) ?? []
        const defaultId = defaultAccountId
        const secondAccount = accounts.find((a) => a._id !== defaultId)?._id ?? ''
        setTransferForm({
            ...emptyTransferForm(),
            fromAccountId: defaultId,
            toAccountId: secondAccount,
        })
        setTransferOpen(true)
    }

    const closeTransfer = () => {
        setTransferOpen(false)
        setTransferForm(emptyTransferForm())
    }

    const openEdit = async (item: Transaction) => {
        if (item.type === 'transfer') {
            toast.error('Transfer editing is not available yet. Delete and recreate the transfer.')
            return
        }

        setEditingId(item._id)
        setForm({
            type: item.type as 'income' | 'expense',
            title: item.title,
            amount: String(item.amount),
            date: toDateInputValue(item.date),
            accountId: item.accountId,
            categoryId: item.categoryId,
            description: item.description ?? '',
            source: item.source ?? '',
            paymentMethod: item.paymentMethod ?? '',
            tags: item.tags ?? [],
            splitEnabled: false,
            splits: [emptySplitLine(), emptySplitLine()],
        })
        setPendingReceiptFiles([])

        try {
            const response = await axiosInstance.get<ApiResponse<Transaction>>(
                API_PATHS.TRANSACTIONS.GET_BY_ID(item._id)
            )
            setAttachedReceipts(unwrapApiData(response).receipts ?? [])
        } catch (err) {
            setAttachedReceipts([])
            toast.error(getApiErrorMessage(err, 'Failed to load transaction receipts'))
        }

        setFormOpen(true)
    }

    const closeForm = () => {
        setFormOpen(false)
        setEditingId(null)
        setForm(emptyForm())
        setAttachedReceipts([])
        setPendingReceiptFiles([])
    }

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault()
        setSearchQuery(searchInput.trim())
        setDateFilterActive(false)
        setPage(1)
    }

    const handleApplyDateFilter = () => {
        if (!startDate || !endDate) {
            toast.error('Start and end dates are required')
            return
        }
        setSearchQuery('')
        setSearchInput('')
        setDateFilterActive(true)
        setPage(1)
    }

    const clearFilters = () => {
        setSearchInput('')
        setSearchQuery('')
        setStartDate('')
        setEndDate('')
        setDateFilterActive(false)
        setTagFilter([])
        setStatusFilter('')
        setPage(1)
    }

    const setStatusFilterWithPage = (value: StatusFilter) => {
        setStatusFilter(value)
        setPage(1)
    }

    const toggleTagFilter = (tagName: string) => {
        setTagFilter((current) =>
            current.includes(tagName)
                ? current.filter((tag) => tag !== tagName)
                : [...current, tagName]
        )
        setPage(1)
    }

    const handleExport = async () => {
        if ((exportStartDate && !exportEndDate) || (!exportStartDate && exportEndDate)) {
            toast.error('Both export start and end dates are required when filtering by date')
            return
        }

        setExporting(true)
        try {
            const params: Record<string, string> = {
                type: exportType,
                format: exportFormat,
                ...buildWorkspaceQueryParams(activeWorkspaceId),
            }

            if (exportStartDate && exportEndDate) {
                params.startDate = exportStartDate
                params.endDate = exportEndDate
            }

            const blobData = await axiosInstance.get<Blob>(API_PATHS.TRANSACTIONS.DOWNLOAD, {
                params,
                responseType: 'blob',
            })

            const blob = ensureExportBlob(blobData, exportFormat)
            const dateSuffix =
                exportStartDate && exportEndDate ? `-${exportStartDate}-${exportEndDate}` : ''
            downloadExportBlob(blob, buildExportFilename(`transactions${dateSuffix}`, exportFormat))
            toast.success('Transactions exported')
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to export transactions'))
        } finally {
            setExporting(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        const usingSplits = form.type === 'expense' && form.splitEnabled && !editingId

        if (
            !form.title.trim() ||
            !form.amount ||
            !form.date ||
            !form.accountId ||
            (!usingSplits && !form.categoryId)
        ) {
            toast.error('Title, amount, date, account, and category are required')
            return
        }

        if (usingSplits) {
            const totalAmount = Number(form.amount)
            const splitTotal = form.splits.reduce((sum, line) => sum + Number(line.amount || 0), 0)
            if (form.splits.some((line) => !line.categoryId || !line.amount)) {
                toast.error('Each split line needs a category and amount')
                return
            }
            if (Math.abs(splitTotal - totalAmount) > 0.001) {
                toast.error('Split amounts must equal the total amount')
                return
            }
        }

        const payload: Record<string, unknown> = {
            type: form.type,
            title: form.title.trim(),
            amount: Number(form.amount),
            date: form.date,
            accountId: form.accountId,
            description: form.description.trim() || undefined,
            ...buildWorkspaceBodyFields(activeWorkspaceId),
        }

        if (usingSplits) {
            payload.splits = form.splits.map((line) => ({
                categoryId: line.categoryId,
                amount: Number(line.amount),
            }))
        } else {
            payload.categoryId = form.categoryId
        }

        if (form.type === 'income') {
            payload.source = form.source.trim() || undefined
        } else {
            payload.paymentMethod = form.paymentMethod.trim() || undefined
            if (form.tags.length > 0) payload.tags = form.tags
        }

        setSubmitting(true)
        try {
            if (editingId) {
                await updateTransaction(editingId, payload)
                toast.success('Transaction updated')
            } else {
                const created = await createTransaction(payload)

                if (created && pendingReceiptFiles.length > 0) {
                    for (const file of pendingReceiptFiles) {
                        const receipt = await uploadReceipt(file)
                        await attachReceiptToTransaction(created._id, receipt._id)
                    }
                } else if (!created && pendingReceiptFiles.length > 0) {
                    // Receipts are server-only (Sprint 13.10 scope) and need the created
                    // transaction's server id; a locally created transaction has no such id until
                    // it syncs, so pending receipt uploads are skipped for local-first creates.
                    toast('Receipts will need to be attached after this transaction syncs.')
                }

                toast.success(
                    usingSplits
                        ? 'Split expense added'
                        : `${form.type === 'income' ? 'Income' : 'Expense'} added`
                )
            }
            closeForm()
            if (!editingId) setPage(1)
            setSelectedIds([])
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to save transaction'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleTransferSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (
            !transferForm.title.trim() ||
            !transferForm.amount ||
            !transferForm.date ||
            !transferForm.fromAccountId ||
            !transferForm.toAccountId
        ) {
            toast.error('Title, amount, date, and both accounts are required')
            return
        }

        if (transferForm.fromAccountId === transferForm.toAccountId) {
            toast.error('Source and destination accounts must be different')
            return
        }

        setTransferSubmitting(true)
        try {
            await createTransfer({
                title: transferForm.title.trim(),
                amount: Number(transferForm.amount),
                date: transferForm.date,
                fromAccountId: transferForm.fromAccountId,
                toAccountId: transferForm.toAccountId,
                description: transferForm.description.trim() || undefined,
                ...buildWorkspaceBodyFields(activeWorkspaceId),
            })
            toast.success('Transfer completed')
            closeTransfer()
            setPage(1)
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to create transfer'))
        } finally {
            setTransferSubmitting(false)
        }
    }

    const updateSplitLine = (index: number, patch: Partial<SplitLineFormData>) => {
        setForm((current) => ({
            ...current,
            splits: current.splits.map((line, i) => (i === index ? { ...line, ...patch } : line)),
        }))
    }

    const addSplitLine = () => {
        setForm((current) => ({
            ...current,
            splits: [...current.splits, emptySplitLine()],
        }))
    }

    const removeSplitLine = (index: number) => {
        setForm((current) => ({
            ...current,
            splits: current.splits.filter((_, i) => i !== index),
        }))
    }

    const splitTotal = form.splits.reduce((sum, line) => sum + Number(line.amount || 0), 0)
    const splitDiff = Number(form.amount || 0) - splitTotal

    const handleDelete = async () => {
        if (!deleteTarget) return

        setDeleting(true)
        try {
            await deleteTransaction(deleteTarget)
            toast.success('Transaction deleted')
            setDeleteTarget(null)
            setSelectedIds((current) => current.filter((id) => id !== deleteTarget._id))
            if (data?.items.length === 1 && page > 1) {
                setPage((p) => p - 1)
            } else {
                await refetch()
            }
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to delete transaction'))
        } finally {
            setDeleting(false)
        }
    }

    const handleDuplicate = async (transaction: Transaction) => {
        setDuplicatingId(transaction._id)
        try {
            await duplicateTransaction(transaction)
            toast.success('Transaction duplicated')
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to duplicate transaction'))
        } finally {
            setDuplicatingId(null)
        }
    }

    const toggleSelected = (transactionId: string) => {
        setSelectedIds((current) =>
            current.includes(transactionId)
                ? current.filter((id) => id !== transactionId)
                : [...current, transactionId]
        )
    }

    const visibleIds = data?.items.map((item) => item._id) ?? []
    const allVisibleSelected =
        visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))

    const toggleSelectAllVisible = () => {
        if (allVisibleSelected) {
            setSelectedIds((current) => current.filter((id) => !visibleIds.includes(id)))
            return
        }
        setSelectedIds((current) => [...new Set([...current, ...visibleIds])])
    }

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) return

        setBulkSubmitting(true)
        try {
            const result = await bulkDeleteTransactions(selectedIds)
            toast.success(result.message)
            setBulkDeleteOpen(false)
            setSelectedIds([])
            setPage(1)
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to delete selected transactions'))
        } finally {
            setBulkSubmitting(false)
        }
    }

    const handleBulkCategoryChange = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!bulkCategoryId || selectedIds.length === 0) {
            toast.error('Choose a category for the selected transactions')
            return
        }

        setBulkSubmitting(true)
        try {
            const result = await bulkChangeCategory(selectedIds, bulkCategoryId)
            toast.success(result.message)
            setBulkCategoryOpen(false)
            setBulkCategoryId('')
            setSelectedIds([])
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to update categories'))
        } finally {
            setBulkSubmitting(false)
        }
    }

    const selectedHasTransfer = useMemo(() => {
        if (!data || selectedIds.length === 0) return false
        return data.items.some(
            (item) => selectedIds.includes(item._id) && item.type === 'transfer'
        )
    }, [data, selectedIds])

    const hasActiveFilters = Boolean(searchQuery || dateFilterActive || tagFilter.length > 0 || statusFilter)
    const hasAdvancedFilters = Boolean(dateFilterActive || tagFilter.length > 0 || statusFilter)
    const hasNonDefaultSort = sortBy !== 'date' || sortOrder !== 'desc'

    const amountColor = (type: TransactionType): string => {
        if (type === 'income') return 'text-accent'
        if (type === 'expense') return 'text-expense'
        return 'text-violet-400'
    }

    const amountPrefix = (type: TransactionType): string => {
        if (type === 'income') return '+'
        if (type === 'expense') return '−'
        return ''
    }

    return (
        <div>
            <PageHeader
                title="Transactions"
                description={
                    isPersonal
                        ? 'Unified income, expense, and transfer ledger'
                        : `Shared ledger in ${activeWorkspace?.name ?? 'workspace'}`
                }
                actions={
                    canEdit ? (
                        <div className="flex items-center gap-2">
                            <QuickAddDropdown onApplied={() => void refetch()} />
                            <Link
                                to="/transactions/import"
                                className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-accent/30 text-accent hover:bg-accent-subtle transition-colors"
                            >
                                <IoCloudUploadOutline size={16} />
                                Import
                            </Link>
                            <button
                                type="button"
                                onClick={() => openCreate('income')}
                                className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-accent/30 text-accent hover:bg-accent-subtle transition-colors"
                            >
                                <IoAdd size={16} />
                                Income
                            </button>
                            <button
                                type="button"
                                onClick={openTransfer}
                                className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-accent/30 text-accent hover:bg-accent-subtle transition-colors"
                            >
                                <IoSwapHorizontal size={16} />
                                Transfer
                            </button>
                            <button
                                type="button"
                                onClick={() => openCreate('expense')}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors"
                            >
                                <IoAdd size={18} />
                                Expense
                            </button>
                        </div>
                    ) : undefined
                }
            />

            <WorkspaceReadOnlyBanner />

            <div className="card mb-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                    {TYPE_TABS.map((tab) => (
                        <button
                            key={tab.value || 'all'}
                            type="button"
                            onClick={() => setTypeFilterWithUrl(tab.value)}
                            className={[
                                'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                                typeFilter === tab.value
                                    ? 'border-accent/40 bg-accent-subtle text-accent'
                                    : 'border-border text-fg-muted hover:border-border',
                            ].join(' ')}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <form onSubmit={handleSearch} className="flex items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                        <IoSearch
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
                            size={16}
                        />
                        <input
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Search by title, description, amount..."
                            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-surface/60 border border-border text-fg placeholder:text-fg-muted outline-none focus:border-accent/40"
                        />
                    </div>
                    <button
                        type="submit"
                        className="shrink-0 px-4 py-2 text-sm font-medium rounded-lg border border-border text-fg-secondary hover:border-accent/40 transition-colors"
                    >
                        Search
                    </button>
                    <button
                        type="button"
                        onClick={() => setAdvancedOpen((open) => !open)}
                        aria-expanded={advancedOpen}
                        className={[
                            'shrink-0 px-4 py-2 text-sm font-medium rounded-lg border transition-colors',
                            advancedOpen || hasAdvancedFilters || hasNonDefaultSort
                                ? 'border-accent/40 bg-accent-subtle text-accent'
                                : 'border-border text-fg-secondary hover:border-accent/40',
                        ].join(' ')}
                    >
                        Advanced features
                    </button>
                </form>

                {searchQuery && !advancedOpen && (
                    <div className="flex items-center justify-between text-xs text-fg-muted">
                        <span>Showing search results for &quot;{searchQuery}&quot;</span>
                        <button
                            type="button"
                            onClick={() => {
                                setSearchInput('')
                                setSearchQuery('')
                                setPage(1)
                            }}
                            className="text-accent hover:text-accent"
                        >
                            Clear search
                        </button>
                    </div>
                )}

                {hasAdvancedFilters && !advancedOpen && (
                    <div className="flex items-center justify-between text-xs text-fg-muted">
                        <span>Advanced filters are active</span>
                        <button
                            type="button"
                            onClick={() => setAdvancedOpen(true)}
                            className="text-accent hover:text-accent"
                        >
                            Show filters
                        </button>
                    </div>
                )}

                {advancedOpen && (
                    <div className="space-y-4 pt-4 border-t border-border-subtle">
                <div>
                    <label className="text-[13px] text-fg-secondary">Status</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {STATUS_OPTIONS.map((opt) => (
                            <button
                                key={opt.value || 'all'}
                                type="button"
                                onClick={() => setStatusFilterWithPage(opt.value)}
                                aria-pressed={statusFilter === opt.value}
                                className={[
                                    'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                                    statusFilter === opt.value
                                        ? 'border-accent/40 bg-accent-subtle text-accent'
                                        : 'border-border text-fg-muted hover:border-border',
                                ].join(' ')}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {(lookups?.tags.length ?? 0) > 0 && (
                    <div>
                        <label className="text-[13px] text-fg-secondary">Filter by tags</label>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {lookups?.tags.map((tag) => {
                                const active = tagFilter.includes(tag.name)
                                return (
                                    <button
                                        key={tag._id}
                                        type="button"
                                        onClick={() => toggleTagFilter(tag.name)}
                                        className={[
                                            'rounded-full transition-opacity',
                                            active ? 'ring-2 ring-accent/50 ring-offset-1 ring-offset-page' : 'opacity-70 hover:opacity-100',
                                        ].join(' ')}
                                    >
                                        <TagChip name={tag.name} color={tag.color} />
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}

                <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
                    <FormField
                        label="From"
                        type="date"
                        value={startDate}
                        onChange={setStartDate}
                    />
                    <FormField
                        label="To"
                        type="date"
                        value={endDate}
                        onChange={setEndDate}
                    />
                    <button
                        type="button"
                        onClick={handleApplyDateFilter}
                        className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-fg-secondary hover:border-accent/40 transition-colors h-[42px]"
                    >
                        Apply dates
                    </button>
                    <div className="flex gap-3 lg:ml-auto">
                        <div>
                            <label className="text-[13px] text-fg-secondary">Sort by</label>
                            <div className="input-box mb-0 mt-1">
                                <select
                                    value={sortBy}
                                    onChange={(e) => {
                                        setSortBy(e.target.value as SortField)
                                        setPage(1)
                                    }}
                                    className="w-full bg-transparent outline-none text-fg min-w-[120px]"
                                >
                                    {SORT_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value} className="bg-surface">
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="text-[13px] text-fg-secondary">Order</label>
                            <div className="input-box mb-0 mt-1">
                                <select
                                    value={sortOrder}
                                    onChange={(e) => {
                                        setSortOrder(e.target.value as SortOrder)
                                        setPage(1)
                                    }}
                                    className="w-full bg-transparent outline-none text-fg min-w-[100px]"
                                >
                                    <option value="desc" className="bg-surface">
                                        Desc
                                    </option>
                                    <option value="asc" className="bg-surface">
                                        Asc
                                    </option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {hasActiveFilters && (
                    <div className="flex items-center justify-between text-xs text-fg-muted">
                        <span>
                            {searchQuery
                                ? `Showing search results for "${searchQuery}"`
                                : `Showing ${startDate} to ${endDate}`}
                        </span>
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="text-accent hover:text-accent"
                        >
                            Clear filters
                        </button>
                    </div>
                )}

                <div className="border-t border-border-subtle pt-4 space-y-3">
                    <div>
                        <h3 className="text-sm font-medium text-fg">Export transactions</h3>
                        <p className="text-xs text-fg-muted mt-1">
                            Download filtered transactions as CSV, JSON, or PDF
                        </p>
                    </div>

                    <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
                        <div>
                            <label className="text-[13px] text-fg-secondary">Include</label>
                            <div className="input-box mb-0 mt-1">
                                <select
                                    value={exportType}
                                    onChange={(e) => setExportType(e.target.value as TransactionExportType)}
                                    className="w-full bg-transparent outline-none text-fg min-w-[160px]"
                                >
                                    {TRANSACTION_EXPORT_TYPE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value} className="bg-surface">
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <FormField
                            label="Export from"
                            type="date"
                            value={exportStartDate}
                            onChange={setExportStartDate}
                        />
                        <FormField
                            label="Export to"
                            type="date"
                            value={exportEndDate}
                            onChange={setExportEndDate}
                        />

                        <div>
                            <label className="text-[13px] text-fg-secondary">Format</label>
                            <div className="input-box mb-0 mt-1">
                                <select
                                    value={exportFormat}
                                    onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                                    className="w-full bg-transparent outline-none text-fg min-w-[100px]"
                                >
                                    {EXPORT_FORMAT_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value} className="bg-surface">
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={handleExport}
                            disabled={exporting}
                            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-accent/30 text-accent hover:bg-accent-subtle disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-[42px]"
                        >
                            <IoDownload size={16} />
                            {exporting ? 'Exporting...' : 'Download'}
                        </button>
                    </div>
                </div>
                    </div>
                )}
            </div>

            <AsyncContent
                loading={loading}
                error={error}
                data={data}
                isEmpty={(result) => result.items.length === 0}
                loadingMessage="Loading transactions..."
                emptyTitle="No transactions yet"
                emptyDescription="Add income or expenses to start tracking."
                onRetry={refetch}
            >
                {(result) => (
                    <>
                        {canEdit && selectedIds.length > 0 && (
                            <div className="card mb-3 flex flex-wrap items-center justify-between gap-3">
                                <p className="text-sm text-fg-secondary">
                                    {selectedIds.length} selected
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setBulkCategoryOpen(true)}
                                        disabled={selectedHasTransfer}
                                        className="px-3 py-1.5 text-sm rounded-lg border border-border text-fg-secondary hover:border-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
                                        title={
                                            selectedHasTransfer
                                                ? 'Transfers cannot be bulk recategorized'
                                                : undefined
                                        }
                                    >
                                        Change category
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setBulkDeleteOpen(true)}
                                        className="px-3 py-1.5 text-sm rounded-lg border border-negative/30 text-expense hover:bg-expense/10"
                                    >
                                        Delete selected
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedIds([])}
                                        className="px-3 py-1.5 text-sm rounded-lg text-fg-muted hover:text-fg-secondary"
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>
                        )}

                        {canEdit && result.items.length > 0 && (
                            <label className="flex items-center gap-2 mb-2 text-xs text-fg-muted px-1">
                                <input
                                    type="checkbox"
                                    checked={allVisibleSelected}
                                    onChange={toggleSelectAllVisible}
                                    className="rounded border-border bg-surface"
                                />
                                Select all on this page
                            </label>
                        )}

                        <div className="space-y-3">
                            {result.items.map((item) => (
                                <div key={item._id} className="card flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        {canEdit && (
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(item._id)}
                                                onChange={() => toggleSelected(item._id)}
                                                className="rounded border-border bg-surface shrink-0"
                                                aria-label={`Select ${item.title}`}
                                            />
                                        )}
                                        <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-medium text-fg truncate">
                                                {item.title}
                                            </p>
                                            <span
                                                className={[
                                                    'text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border',
                                                    item.type === 'income'
                                                        ? 'border-accent/30 text-accent'
                                                        : item.type === 'expense'
                                                          ? 'border-negative/30 text-expense'
                                                          : 'border-accent/30 text-accent',
                                                ].join(' ')}
                                            >
                                                {item.type}
                                            </span>
                                            {item.status === 'draft' && (
                                                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-warning/30 text-warning">
                                                    Draft
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-fg-muted mt-0.5">
                                            {formatDisplayDate(item.date)}
                                            {categoryNameById.get(item.categoryId)
                                                ? ` · ${categoryNameById.get(item.categoryId)}`
                                                : ''}
                                            {accountNameById.get(item.accountId)
                                                ? ` · ${accountNameById.get(item.accountId)}`
                                                : ''}
                                            {!isPersonal && item.userFullName
                                                ? ` · ${transactionUserLabel(item.type, item.userFullName)}`
                                                : ''}
                                        </p>
                                        {item.tags && item.tags.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5 mt-2">
                                                {item.tags.map((tag) => (
                                                    <TagChip
                                                        key={`${item._id}-${tag}`}
                                                        name={tag}
                                                        color={
                                                            tagColorByName.get(tag) ??
                                                            tagColorByName.get(tag.toLowerCase())
                                                        }
                                                    />
                                                ))}
                                            </div>
                                        )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <p className={`text-sm font-semibold ${amountColor(item.type)}`}>
                                            {amountPrefix(item.type)}
                                            {formatCurrency(item.amount, item.currency)}
                                        </p>
                                        {canEdit && item.type !== 'transfer' && (
                                            <button
                                                type="button"
                                                onClick={() => openEdit(item)}
                                                className="p-1.5 text-fg-muted hover:text-accent transition-colors"
                                                aria-label="Edit transaction"
                                            >
                                                <IoPencil size={16} />
                                            </button>
                                        )}
                                        {canEdit && item.type !== 'transfer' && (
                                            <button
                                                type="button"
                                                onClick={() => void handleDuplicate(item)}
                                                disabled={duplicatingId === item._id}
                                                className="p-1.5 text-fg-muted hover:text-accent transition-colors disabled:opacity-50"
                                                aria-label="Duplicate transaction"
                                                title="Duplicate"
                                            >
                                                <IoCopyOutline size={16} />
                                            </button>
                                        )}
                                        {canEdit && (
                                            <button
                                                type="button"
                                                onClick={() => setDeleteTarget(item)}
                                                className="p-1.5 text-fg-muted hover:text-expense transition-colors"
                                                aria-label="Delete transaction"
                                            >
                                                <IoTrash size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                        {result.mode === 'list' && result.meta && (
                            <Pagination
                                page={result.meta.pageNumber}
                                totalPages={result.meta.totalPages}
                                totalItems={result.meta.totalTransactions ?? result.items.length}
                                onPageChange={onPageChange}
                            />
                        )}
                    </>
                )}
            </AsyncContent>

            <Modal
                open={formOpen}
                onClose={closeForm}
                size="lg"
                title={
                    editingId
                        ? 'Edit transaction'
                        : form.type === 'income'
                          ? 'Add income'
                          : 'Add expense'
                }
            >
                <form onSubmit={handleSubmit} className="space-y-4">
                    {!editingId && (
                        <div>
                            <label className="text-[13px] text-fg-secondary">Type</label>
                            <div className="input-box mb-0 mt-1">
                                <select
                                    value={form.type}
                                    onChange={(e) =>
                                        setForm((f) => ({
                                            ...f,
                                            type: e.target.value as 'income' | 'expense',
                                            categoryId: '',
                                        }))
                                    }
                                    disabled={submitting}
                                    className="w-full bg-transparent outline-none text-fg"
                                >
                                    <option value="income" className="bg-surface">
                                        Income
                                    </option>
                                    <option value="expense" className="bg-surface">
                                        Expense
                                    </option>
                                </select>
                            </div>
                        </div>
                    )}
                    <FormField
                        label="Title"
                        value={form.title}
                        onChange={(v) => setForm((f) => ({ ...f, title: v }))}
                        placeholder={form.type === 'income' ? 'Salary, freelance, etc.' : 'Groceries, rent, etc.'}
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
                    <AccountPicker
                        value={form.accountId}
                        onChange={(accountId) => setForm((f) => ({ ...f, accountId }))}
                        accountsData={lookups?.accounts.filter((a) => !a.isArchived)}
                        required
                        disabled={submitting}
                    />
                    {form.type === 'expense' && !editingId && (
                        <label className="flex items-center gap-2 text-sm text-fg-secondary">
                            <input
                                type="checkbox"
                                checked={form.splitEnabled}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        splitEnabled: e.target.checked,
                                        categoryId: e.target.checked ? '' : f.categoryId,
                                    }))
                                }
                                disabled={submitting}
                                className="rounded border-border bg-surface"
                            />
                            Split across categories
                        </label>
                    )}
                    {form.splitEnabled && form.type === 'expense' && !editingId ? (
                        <div className="space-y-3 rounded-lg border border-border p-3">
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-fg-secondary">Split lines</p>
                                <button
                                    type="button"
                                    onClick={addSplitLine}
                                    disabled={submitting}
                                    className="text-xs text-accent hover:text-accent"
                                >
                                    + Add line
                                </button>
                            </div>
                            {form.splits.map((line, index) => (
                                <div key={index} className="grid grid-cols-[1fr_120px_auto] gap-2 items-end">
                                    <CategoryPicker
                                        value={line.categoryId}
                                        onChange={(categoryId) => updateSplitLine(index, { categoryId })}
                                        categoriesData={lookups?.categories}
                                        required
                                        disabled={submitting}
                                        label={index === 0 ? 'Category' : undefined}
                                    />
                                    <FormField
                                        label={index === 0 ? 'Amount' : ' '}
                                        type="number"
                                        value={line.amount}
                                        onChange={(v) => updateSplitLine(index, { amount: v })}
                                        placeholder="0.00"
                                        required
                                        disabled={submitting}
                                        min="0"
                                        step="0.01"
                                    />
                                    {form.splits.length > 2 && (
                                        <button
                                            type="button"
                                            onClick={() => removeSplitLine(index)}
                                            disabled={submitting}
                                            className="p-2 text-fg-muted hover:text-expense"
                                            aria-label="Remove split line"
                                        >
                                            <IoTrash size={14} />
                                        </button>
                                    )}
                                </div>
                            ))}
                            <p
                                className={[
                                    'text-xs',
                                    Math.abs(splitDiff) < 0.001 ? 'text-fg-muted' : 'text-warning',
                                ].join(' ')}
                            >
                                Split total: {splitTotal.toFixed(2)}
                                {Math.abs(splitDiff) >= 0.001
                                    ? ` (${splitDiff > 0 ? 'remaining' : 'over'} ${Math.abs(splitDiff).toFixed(2)})`
                                    : ' · matches total'}
                            </p>
                        </div>
                    ) : (
                        <CategoryPicker
                            value={form.categoryId}
                            onChange={(categoryId) => setForm((f) => ({ ...f, categoryId }))}
                            masterCategoryId={form.type === 'income' ? incomeMasterId : undefined}
                            categoriesData={lookups?.categories}
                            required
                            disabled={submitting}
                        />
                    )}
                    {form.type === 'income' ? (
                        <FormField
                            label="Source"
                            value={form.source}
                            onChange={(v) => setForm((f) => ({ ...f, source: v }))}
                            placeholder="Employer or client"
                            disabled={submitting}
                        />
                    ) : (
                        <>
                            <FormField
                                label="Payment method"
                                value={form.paymentMethod}
                                onChange={(v) => setForm((f) => ({ ...f, paymentMethod: v }))}
                                placeholder="Card, cash, UPI, etc."
                                disabled={submitting}
                            />
                            <TagPicker
                                value={form.tags}
                                onChange={(tags) => setForm((f) => ({ ...f, tags }))}
                                tagsData={lookups?.tags}
                                onTagsChange={refetchLookups}
                                disabled={submitting}
                            />
                        </>
                    )}
                    <TextAreaField
                        label="Notes"
                        value={form.description}
                        onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                        placeholder="Optional notes"
                        disabled={submitting}
                    />
                    {!form.splitEnabled && (
                        <ReceiptAttachments
                            transactionId={editingId}
                            receipts={attachedReceipts}
                            onChange={setAttachedReceipts}
                            pendingFiles={pendingReceiptFiles}
                            onPendingFilesChange={setPendingReceiptFiles}
                            disabled={submitting}
                        />
                    )}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={closeForm}
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
                            {submitting ? 'Saving...' : editingId ? 'Update' : 'Add transaction'}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal open={transferOpen} onClose={closeTransfer} size="lg" title="Transfer between accounts">
                <form onSubmit={handleTransferSubmit} className="space-y-4">
                    <FormField
                        label="Title"
                        value={transferForm.title}
                        onChange={(v) => setTransferForm((f) => ({ ...f, title: v }))}
                        placeholder="Move to savings, pay credit card, etc."
                        required
                        disabled={transferSubmitting}
                    />
                    <div className="grid grid-cols-2 gap-4">
                        <FormField
                            label="Amount"
                            type="number"
                            value={transferForm.amount}
                            onChange={(v) => setTransferForm((f) => ({ ...f, amount: v }))}
                            placeholder="0.00"
                            required
                            disabled={transferSubmitting}
                            min="0"
                            step="0.01"
                        />
                        <FormField
                            label="Date"
                            type="date"
                            value={transferForm.date}
                            onChange={(v) => setTransferForm((f) => ({ ...f, date: v }))}
                            required
                            disabled={transferSubmitting}
                        />
                    </div>
                    <AccountPicker
                        value={transferForm.fromAccountId}
                        onChange={(fromAccountId) =>
                            setTransferForm((f) => ({ ...f, fromAccountId }))
                        }
                        accountsData={lookups?.accounts.filter((a) => !a.isArchived)}
                        label="From account"
                        required
                        disabled={transferSubmitting}
                    />
                    <AccountPicker
                        value={transferForm.toAccountId}
                        onChange={(toAccountId) => setTransferForm((f) => ({ ...f, toAccountId }))}
                        accountsData={lookups?.accounts.filter((a) => !a.isArchived)}
                        label="To account"
                        required
                        disabled={transferSubmitting}
                    />
                    <TextAreaField
                        label="Notes"
                        value={transferForm.description}
                        onChange={(v) => setTransferForm((f) => ({ ...f, description: v }))}
                        placeholder="Optional notes"
                        disabled={transferSubmitting}
                    />
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={closeTransfer}
                            disabled={transferSubmitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-border text-fg-secondary hover:border-border transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={transferSubmitting}
                            className="flex-1 px-4 py-2 btn-accent disabled:opacity-50"
                        >
                            {transferSubmitting ? 'Transferring...' : 'Transfer'}
                        </button>
                    </div>
                </form>
            </Modal>

            <ConfirmDialog
                open={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDelete}
                title="Delete transaction"
                message={
                    deleteTarget?.type === 'transfer'
                        ? `Delete transfer "${deleteTarget.title}"? Both linked legs will be removed and account balances restored.`
                        : `Are you sure you want to delete "${deleteTarget?.title}"? This will reverse the account balance change.`
                }
                loading={deleting}
            />

            <ConfirmDialog
                open={bulkDeleteOpen}
                onClose={() => setBulkDeleteOpen(false)}
                onConfirm={handleBulkDelete}
                title="Delete selected transactions"
                message={`Delete ${selectedIds.length} selected transaction${selectedIds.length === 1 ? '' : 's'}? Transfer pairs and split children will be handled automatically.`}
                loading={bulkSubmitting}
            />

            <Modal
                open={bulkCategoryOpen}
                onClose={() => {
                    setBulkCategoryOpen(false)
                    setBulkCategoryId('')
                }}
                title="Change category"
                size="md"
            >
                <form onSubmit={handleBulkCategoryChange} className="space-y-4">
                    <p className="text-sm text-fg-muted">
                        Apply a new category to {selectedIds.length} selected transaction
                        {selectedIds.length === 1 ? '' : 's'}. Transfers are excluded.
                    </p>
                    <CategoryPicker
                        value={bulkCategoryId}
                        onChange={setBulkCategoryId}
                        categoriesData={lookups?.categories}
                        required
                        disabled={bulkSubmitting}
                    />
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={() => {
                                setBulkCategoryOpen(false)
                                setBulkCategoryId('')
                            }}
                            disabled={bulkSubmitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-border text-fg-secondary hover:border-border transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={bulkSubmitting || !bulkCategoryId}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors disabled:opacity-50"
                        >
                            {bulkSubmitting ? 'Updating...' : 'Update category'}
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    )
}

export default Transactions
