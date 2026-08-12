import React, { useCallback, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import toast from 'react-hot-toast'
import { IoAdd, IoPencil, IoSearch, IoSwapHorizontal, IoTrash } from 'react-icons/io5'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import Modal from '../../components/ui/Modal'
import Pagination from '../../components/ui/Pagination'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import FormField, { TextAreaField } from '../../components/forms/FormField'
import CategoryPicker from '../../components/categories/CategoryPicker'
import AccountPicker from '../../components/accounts/AccountPicker'
import ReceiptAttachments from '../../components/transactions/ReceiptAttachments'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import type {
    Account,
    ApiResponse,
    BulkCategoryResponse,
    BulkDeleteResponse,
    CategoriesResponse,
    PaginatedTransactions,
    Receipt,
    SplitLineFormData,
    Transaction,
    TransactionFormData,
    TransactionType,
    TransferCreateResponse,
    TransferFormData,
} from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatCurrency, toDateInputValue } from '../../utils/format'
import { attachReceiptToTransaction, uploadReceipt } from '../../utils/receiptApi'

const PAGE_LIMIT = 10

type TypeFilter = '' | 'income' | 'expense' | 'transfer'
type SortField = 'date' | 'amount' | 'category'
type SortOrder = 'asc' | 'desc'
type FetchMode = 'list' | 'search' | 'filter'

interface TransactionsPageData {
    items: Transaction[]
    meta: PaginatedTransactions['meta'] | null
    mode: FetchMode
}

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
    tags: '',
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

const SORT_OPTIONS: { value: SortField; label: string }[] = [
    { value: 'date', label: 'Date' },
    { value: 'amount', label: 'Amount' },
    { value: 'category', label: 'Category' },
]

const Transactions = () => {
    const [searchParams, setSearchParams] = useSearchParams()

    const initialType = (searchParams.get('type') as TypeFilter) || ''
    const [page, setPage] = useState(1)
    const [typeFilter, setTypeFilter] = useState<TypeFilter>(
        initialType === 'income' || initialType === 'expense' || initialType === 'transfer'
            ? initialType
            : ''
    )
    const [searchInput, setSearchInput] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [dateFilterActive, setDateFilterActive] = useState(false)
    const [sortBy, setSortBy] = useState<SortField>('date')
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

    const [formOpen, setFormOpen] = useState(false)
    const [transferOpen, setTransferOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState<TransactionFormData>(emptyForm())
    const [transferForm, setTransferForm] = useState<TransferFormData>(emptyTransferForm())
    const [submitting, setSubmitting] = useState(false)
    const [transferSubmitting, setTransferSubmitting] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null)
    const [deleting, setDeleting] = useState(false)
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
    const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false)
    const [bulkCategoryId, setBulkCategoryId] = useState('')
    const [bulkSubmitting, setBulkSubmitting] = useState(false)
    const [attachedReceipts, setAttachedReceipts] = useState<Receipt[]>([])
    const [pendingReceiptFiles, setPendingReceiptFiles] = useState<File[]>([])

    const fetchLookups = useCallback(async () => {
        const [accountsRes, categoriesRes] = await Promise.all([
            axiosInstance.get<ApiResponse<Account[]>>(API_PATHS.ACCOUNTS.GET_ALL),
            axiosInstance.get<ApiResponse<CategoriesResponse>>(API_PATHS.CATEGORIES.GET_ALL),
        ])
        return {
            accounts: unwrapApiData(accountsRes),
            categories: unwrapApiData(categoriesRes),
        }
    }, [])

    const { data: lookups } = useAsyncData(fetchLookups, [fetchLookups])

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

    const fetchTransactions = useCallback(async (): Promise<TransactionsPageData> => {
        try {
            const sharedParams: Record<string, string> = {
                sortBy,
                sortOrder,
            }
            if (typeFilter) sharedParams.type = typeFilter

            if (searchQuery.trim()) {
                const response = await axiosInstance.get<ApiResponse<Transaction[]>>(
                    API_PATHS.TRANSACTIONS.SEARCH,
                    { params: { keyword: searchQuery.trim(), ...sharedParams } }
                )
                return { items: unwrapApiData(response), meta: null, mode: 'search' }
            }

            if (dateFilterActive && startDate && endDate) {
                const response = await axiosInstance.get<ApiResponse<Transaction[]>>(
                    API_PATHS.TRANSACTIONS.FILTER,
                    { params: { startDate, endDate, ...sharedParams } }
                )
                return { items: unwrapApiData(response), meta: null, mode: 'filter' }
            }

            const response = await axiosInstance.get<ApiResponse<PaginatedTransactions>>(
                API_PATHS.TRANSACTIONS.GET_ALL,
                { params: { page, limit: PAGE_LIMIT, ...sharedParams } }
            )
            const payload = unwrapApiData(response)
            return { items: payload.data, meta: payload.meta, mode: 'list' }
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load transactions'))
        }
    }, [page, typeFilter, searchQuery, dateFilterActive, startDate, endDate, sortBy, sortOrder])

    const { data, loading, error, refetch } = useAsyncData(fetchTransactions, [fetchTransactions])

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
            tags: item.tags?.join(', ') ?? '',
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
        setPage(1)
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
            const tags = form.tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            if (tags.length > 0) payload.tags = tags
        }

        setSubmitting(true)
        try {
            if (editingId) {
                await axiosInstance.put(API_PATHS.TRANSACTIONS.UPDATE(editingId), payload)
                toast.success('Transaction updated')
            } else {
                const response = await axiosInstance.post<ApiResponse<Transaction>>(
                    API_PATHS.TRANSACTIONS.CREATE,
                    payload
                )
                const created = unwrapApiData(response)

                if (pendingReceiptFiles.length > 0) {
                    for (const file of pendingReceiptFiles) {
                        const receipt = await uploadReceipt(file)
                        await attachReceiptToTransaction(created._id, receipt._id)
                    }
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
            await axiosInstance.post<ApiResponse<TransferCreateResponse>>(
                API_PATHS.TRANSACTIONS.TRANSFER,
                {
                    title: transferForm.title.trim(),
                    amount: Number(transferForm.amount),
                    date: transferForm.date,
                    fromAccountId: transferForm.fromAccountId,
                    toAccountId: transferForm.toAccountId,
                    description: transferForm.description.trim() || undefined,
                }
            )
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
            await axiosInstance.delete(API_PATHS.TRANSACTIONS.DELETE(deleteTarget._id))
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
            const response = await axiosInstance.post<ApiResponse<BulkDeleteResponse>>(
                API_PATHS.TRANSACTIONS.BULK_DELETE,
                { transactionIds: selectedIds }
            )
            const result = unwrapApiData(response)
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
            const response = await axiosInstance.patch<ApiResponse<BulkCategoryResponse>>(
                API_PATHS.TRANSACTIONS.BULK_CATEGORY,
                { transactionIds: selectedIds, categoryId: bulkCategoryId }
            )
            const result = unwrapApiData(response)
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

    const hasActiveFilters = Boolean(searchQuery || dateFilterActive)

    const amountColor = (type: TransactionType): string => {
        if (type === 'income') return 'text-cyan-400'
        if (type === 'expense') return 'text-rose-400'
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
                description="Unified income, expense, and transfer ledger"
                actions={
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => openCreate('income')}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                        >
                            <IoAdd size={16} />
                            Income
                        </button>
                        <button
                            type="button"
                            onClick={openTransfer}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-violet-500/30 text-violet-300 hover:bg-violet-500/10 transition-colors"
                        >
                            <IoSwapHorizontal size={16} />
                            Transfer
                        </button>
                        <button
                            type="button"
                            onClick={() => openCreate('expense')}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors"
                        >
                            <IoAdd size={18} />
                            Expense
                        </button>
                    </div>
                }
            />

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
                                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                                    : 'border-slate-700 text-slate-400 hover:border-slate-600',
                            ].join(' ')}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 relative">
                        <IoSearch
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                            size={16}
                        />
                        <input
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Search by title, description, amount..."
                            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-slate-900/60 border border-slate-700 text-slate-200 placeholder:text-slate-500 outline-none focus:border-cyan-500/40"
                        />
                    </div>
                    <button
                        type="submit"
                        className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 text-slate-300 hover:border-cyan-500/40 transition-colors"
                    >
                        Search
                    </button>
                </form>

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
                        className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 text-slate-300 hover:border-cyan-500/40 transition-colors h-[42px]"
                    >
                        Apply dates
                    </button>
                    <div className="flex gap-3 lg:ml-auto">
                        <div>
                            <label className="text-[13px] text-slate-300">Sort by</label>
                            <div className="input-box mb-0 mt-1">
                                <select
                                    value={sortBy}
                                    onChange={(e) => {
                                        setSortBy(e.target.value as SortField)
                                        setPage(1)
                                    }}
                                    className="w-full bg-transparent outline-none text-slate-200 min-w-[120px]"
                                >
                                    {SORT_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value} className="bg-slate-900">
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="text-[13px] text-slate-300">Order</label>
                            <div className="input-box mb-0 mt-1">
                                <select
                                    value={sortOrder}
                                    onChange={(e) => {
                                        setSortOrder(e.target.value as SortOrder)
                                        setPage(1)
                                    }}
                                    className="w-full bg-transparent outline-none text-slate-200 min-w-[100px]"
                                >
                                    <option value="desc" className="bg-slate-900">
                                        Desc
                                    </option>
                                    <option value="asc" className="bg-slate-900">
                                        Asc
                                    </option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {hasActiveFilters && (
                    <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>
                            {searchQuery
                                ? `Showing search results for "${searchQuery}"`
                                : `Showing ${startDate} to ${endDate}`}
                        </span>
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="text-cyan-400 hover:text-cyan-300"
                        >
                            Clear filters
                        </button>
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
                        {selectedIds.length > 0 && (
                            <div className="card mb-3 flex flex-wrap items-center justify-between gap-3">
                                <p className="text-sm text-slate-300">
                                    {selectedIds.length} selected
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setBulkCategoryOpen(true)}
                                        disabled={selectedHasTransfer}
                                        className="px-3 py-1.5 text-sm rounded-lg border border-slate-700 text-slate-300 hover:border-cyan-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
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
                                        className="px-3 py-1.5 text-sm rounded-lg border border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                                    >
                                        Delete selected
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedIds([])}
                                        className="px-3 py-1.5 text-sm rounded-lg text-slate-400 hover:text-slate-300"
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>
                        )}

                        {result.items.length > 0 && (
                            <label className="flex items-center gap-2 mb-2 text-xs text-slate-500 px-1">
                                <input
                                    type="checkbox"
                                    checked={allVisibleSelected}
                                    onChange={toggleSelectAllVisible}
                                    className="rounded border-slate-600 bg-slate-900"
                                />
                                Select all on this page
                            </label>
                        )}

                        <div className="space-y-3">
                            {result.items.map((item) => (
                                <div key={item._id} className="card flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.includes(item._id)}
                                            onChange={() => toggleSelected(item._id)}
                                            className="rounded border-slate-600 bg-slate-900 shrink-0"
                                            aria-label={`Select ${item.title}`}
                                        />
                                        <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-medium text-slate-200 truncate">
                                                {item.title}
                                            </p>
                                            <span
                                                className={[
                                                    'text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border',
                                                    item.type === 'income'
                                                        ? 'border-cyan-500/30 text-cyan-400'
                                                        : item.type === 'expense'
                                                          ? 'border-rose-500/30 text-rose-400'
                                                          : 'border-violet-500/30 text-violet-400',
                                                ].join(' ')}
                                            >
                                                {item.type}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            {dayjs(item.date).format('MMM D, YYYY')}
                                            {categoryNameById.get(item.categoryId)
                                                ? ` · ${categoryNameById.get(item.categoryId)}`
                                                : ''}
                                            {accountNameById.get(item.accountId)
                                                ? ` · ${accountNameById.get(item.accountId)}`
                                                : ''}
                                        </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <p className={`text-sm font-semibold ${amountColor(item.type)}`}>
                                            {amountPrefix(item.type)}
                                            {formatCurrency(item.amount, item.currency)}
                                        </p>
                                        {item.type !== 'transfer' && (
                                            <button
                                                type="button"
                                                onClick={() => openEdit(item)}
                                                className="p-1.5 text-slate-400 hover:text-cyan-400 transition-colors"
                                                aria-label="Edit transaction"
                                            >
                                                <IoPencil size={16} />
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setDeleteTarget(item)}
                                            className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors"
                                            aria-label="Delete transaction"
                                        >
                                            <IoTrash size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {result.mode === 'list' && result.meta && (
                            <Pagination
                                page={result.meta.pageNumber}
                                totalPages={result.meta.totalPages}
                                totalItems={result.meta.totalTransactions ?? result.items.length}
                                onPageChange={setPage}
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
                            <label className="text-[13px] text-slate-300">Type</label>
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
                                    className="w-full bg-transparent outline-none text-slate-200"
                                >
                                    <option value="income" className="bg-slate-900">
                                        Income
                                    </option>
                                    <option value="expense" className="bg-slate-900">
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
                        <label className="flex items-center gap-2 text-sm text-slate-300">
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
                                className="rounded border-slate-600 bg-slate-900"
                            />
                            Split across categories
                        </label>
                    )}
                    {form.splitEnabled && form.type === 'expense' && !editingId ? (
                        <div className="space-y-3 rounded-lg border border-slate-700 p-3">
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-slate-300">Split lines</p>
                                <button
                                    type="button"
                                    onClick={addSplitLine}
                                    disabled={submitting}
                                    className="text-xs text-cyan-400 hover:text-cyan-300"
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
                                            className="p-2 text-slate-500 hover:text-rose-400"
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
                                    Math.abs(splitDiff) < 0.001 ? 'text-slate-500' : 'text-amber-400',
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
                            <FormField
                                label="Tags"
                                value={form.tags}
                                onChange={(v) => setForm((f) => ({ ...f, tags: v }))}
                                placeholder="Comma-separated tags"
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
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 text-slate-300 hover:border-slate-600 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors disabled:opacity-50"
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
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 text-slate-300 hover:border-slate-600 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={transferSubmitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-400 transition-colors disabled:opacity-50"
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
                    <p className="text-sm text-slate-400">
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
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 text-slate-300 hover:border-slate-600 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={bulkSubmitting || !bulkCategoryId}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors disabled:opacity-50"
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
