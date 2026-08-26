import { useCallback, useEffect, useMemo } from 'react'
import { fromMinorUnits, parseAmountToMinorUnits } from '@shared/money'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'
import { useAsyncData } from '../../../hooks/useAsyncData'
import { useLocalQuery } from '../../../db/useLocalQuery'
import { usePaginatedList } from '../../../hooks/usePaginatedList'
import { getLocalDb } from '../../../db/localDbInstance'
import { tableInvalidationBus } from '../../../db/invalidation/tableInvalidationBus'
import { Repository } from '../../../db/repositories/Repository'
import { generateLocalObjectId } from '../../../db/generateLocalId'
import { isLocalFirstEnabled } from '../../../utils/localFirstFlag'
import {
    listLocalTransactions,
    filterLocalTransactions,
    searchLocalTransactions,
    type TransactionListFilters,
    type TransactionSortBy,
    type TransactionSortOrder,
} from '../../../domain/transactionSearch'
import { applyLocalCategorizationRules } from '../../../domain/categorizationRules'
import { recomputeLocalAccountBalance } from '../../../domain/accountBalances'
import { createLocalTransfer } from '../../../domain/transfers'
import { createLocalSplitExpense } from '../../../domain/splits'
import { unwrapApiData } from '../../../utils/apiHelpers'
import { getApiErrorMessage } from '../../../utils/apiError'
import { buildWorkspaceQueryParams } from '../../../utils/workspaceScope'
import { useUser } from '../../../hooks/useUser'
import type { LocalAccount, LocalTransaction } from '../../../domain/types'
import type { LocalDb } from '../../../db/LocalDb'
import type {
    ApiResponse,
    BulkCategoryResponse,
    BulkDeleteResponse,
    ClearedStatus,
    PaginatedTransactions,
    PaginationMeta,
    Transaction,
} from '../../../types/api'

const transactionsRepo = new Repository<LocalTransaction>('transactions')
const accountsRepo = new Repository<LocalAccount>('accounts')

export type TypeFilter = '' | 'income' | 'expense' | 'transfer'
export type SortField = TransactionSortBy
export type SortOrder = TransactionSortOrder
export type FetchMode = 'list' | 'search' | 'filter'

export interface TransactionsPageData {
    items: Transaction[]
    meta: PaginatedTransactions['meta'] | null
    mode: FetchMode
}

export interface UseTransactionsDataParams {
    page: number
    setPage: (page: number) => void
    pageSize: number
    typeFilter: TypeFilter
    tagFilter: string[]
    searchQuery: string
    dateFilterActive: boolean
    startDate: string
    endDate: string
    sortBy: SortField
    sortOrder: SortOrder
    activeWorkspaceId: string | null
    timezone: string
}

export interface UseTransactionsDataResult {
    data: TransactionsPageData | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
    /** Bind directly to `<Pagination onPageChange>` - source of truth for page navigation differs
     * by branch (the page's own `page` state server-side, `usePaginatedList`'s internal state
     * locally), so callers should not assume `params.setPage` is equivalent to this. */
    onPageChange: (page: number) => void
    /** Returns the created transaction server-side (so the caller can immediately attach pending
     * receipts), or `null` in local-first mode - a locally created record has no server-side
     * counterpart to attach a receipt to until it syncs (receipts stay out of scope for 13.9). */
    createTransaction: (payload: Record<string, unknown>) => Promise<Transaction | null>
    updateTransaction: (transactionId: string, payload: Record<string, unknown>) => Promise<void>
    deleteTransaction: (transaction: Transaction) => Promise<void>
    createTransfer: (payload: Record<string, unknown>) => Promise<void>
    bulkDeleteTransactions: (transactionIds: string[]) => Promise<{ message: string }>
    bulkChangeCategory: (transactionIds: string[], categoryId: string) => Promise<{ message: string }>
}

/** `LocalTransaction` (domain/types.ts) has no `currency` field yet - it round-trips fine through
 * the JSON `data` blob (Repository stores the full doc); this just widens the local type so this
 * hook can join in the owning account's currency for display without touching shared infra. */
interface LocalTransactionRecord extends LocalTransaction {
    currency?: string
}

const toApiTransaction = (tx: LocalTransactionRecord, currency: string): Transaction => ({
    _id: tx._id,
    userId: tx.userId,
    workspaceId: tx.workspaceId ?? null,
    accountId: tx.accountId,
    categoryId: tx.categoryId,
    type: tx.type,
    status: tx.status,
    amount: fromMinorUnits(tx.amount),
    currency,
    title: tx.title,
    description: tx.description,
    date: tx.date,
    source: tx.source,
    paymentMethod: tx.paymentMethod,
    tags: tx.tags,
    transferPairId: tx.transferPairId ?? null,
    splitTransactionId: tx.splitTransactionId ?? null,
    clearedStatus: (tx.clearedStatus ?? 'pending') as ClearedStatus,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
})

/** Mirrors `backend/utils/categorizationRuleUtils.ts`'s `mergeTags`: dedupe the transaction's own
 * tags with the ones a matched categorization rule adds. */
const mergeTags = (existing: string[] | undefined, ruleTags: string[] | undefined): string[] | undefined => {
    if (!ruleTags || ruleTags.length === 0) return existing
    const merged = [...new Set([...(existing ?? []), ...ruleTags])]
    return merged.length > 0 ? merged : undefined
}

/** See `domain/transfers.ts`'s identical helper for why this writes `accounts` directly. */
const persistAccountBalance = async (db: LocalDb, accountId: string): Promise<void> => {
    const account = await accountsRepo.findById(db, accountId)
    if (!account) throw new Error(`Account ${accountId} not found locally`)
    const balance = await recomputeLocalAccountBalance(db, accountId)
    const updated: LocalAccount = { ...account, currentBalance: balance }
    await db.exec(`UPDATE accounts SET data = ?, currentBalance = ?, _localUpdatedAt = ? WHERE _id = ?`, [
        JSON.stringify(updated),
        balance,
        new Date().toISOString(),
        accountId,
    ])
}

/**
 * Data layer for the Transactions dashboard page (Sprint 13.9). Branches on `isLocalFirstEnabled()`:
 * the server branch is the page's pre-existing `useAsyncData` + axios code, relocated verbatim
 * (server-side pagination); the local branch reads through `domain/transactionSearch.ts` and writes
 * through `Repository`/`domain/transfers.ts`/`domain/splits.ts`, with client-side pagination via
 * `usePaginatedList` since the local domain read functions return the full filtered/sorted array.
 */
export const useTransactionsData = (params: UseTransactionsDataParams): UseTransactionsDataResult => {
    const { user } = useUser()
    const localFirst = isLocalFirstEnabled()
    const {
        page,
        setPage,
        pageSize,
        typeFilter,
        tagFilter,
        searchQuery,
        dateFilterActive,
        startDate,
        endDate,
        sortBy,
        sortOrder,
        activeWorkspaceId,
        timezone,
    } = params

    // --- server branch: relocated verbatim from the page ---

    const fetchTransactionsServer = useCallback(async (): Promise<TransactionsPageData> => {
        // Both branches' hooks are always called (rules of hooks), but when local-first is on the
        // server branch's result is never read - skip the network round-trip rather than firing it
        // uselessly on every mount/filter change (mirrors `useAccountsData.ts`/`useCategoriesData.ts`).
        if (localFirst) return { items: [], meta: null, mode: 'list' }
        try {
            const workspaceParams = buildWorkspaceQueryParams(activeWorkspaceId)
            const sharedParams: Record<string, string> = {
                sortBy,
                sortOrder,
                ...workspaceParams,
            }
            if (typeFilter) sharedParams.type = typeFilter
            if (tagFilter.length > 0) sharedParams.tags = tagFilter.join(',')

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
                { params: { page, limit: pageSize, ...sharedParams } }
            )
            const payload = unwrapApiData(response)
            return { items: payload.data, meta: payload.meta, mode: 'list' }
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load transactions'))
        }
    }, [
        localFirst,
        page,
        pageSize,
        typeFilter,
        searchQuery,
        dateFilterActive,
        startDate,
        endDate,
        sortBy,
        sortOrder,
        activeWorkspaceId,
        tagFilter,
    ])

    const serverQuery = useAsyncData(fetchTransactionsServer, [fetchTransactionsServer])

    // --- local branch ---

    const localListFetcher = useCallback(
        async (db: LocalDb): Promise<LocalTransactionRecord[]> => {
            const filters: TransactionListFilters = {}
            if (typeFilter) filters.type = typeFilter
            if (tagFilter.length > 0) filters.tags = tagFilter

            let transactions: LocalTransaction[]
            if (searchQuery.trim()) {
                transactions = await searchLocalTransactions(db, searchQuery.trim(), filters, sortBy, sortOrder)
            } else if (dateFilterActive && startDate && endDate) {
                transactions = await filterLocalTransactions(db, startDate, endDate, timezone, filters, sortBy, sortOrder)
            } else {
                transactions = await listLocalTransactions(db, filters, sortBy, sortOrder)
            }

            const scoped = transactions.filter((tx) =>
                activeWorkspaceId ? tx.workspaceId === activeWorkspaceId : !tx.workspaceId
            )

            const accounts = await accountsRepo.list(db)
            const currencyByAccountId = new Map(accounts.map((account) => [account._id, account.currency]))

            return scoped.map((tx) => ({ ...tx, currency: currencyByAccountId.get(tx.accountId) ?? 'USD' }))
        },
        [typeFilter, tagFilter, searchQuery, dateFilterActive, startDate, endDate, sortBy, sortOrder, timezone, activeWorkspaceId]
    )

    const localQuery = useLocalQuery<LocalTransactionRecord[]>('transactions', localListFetcher)

    // `useLocalQuery`'s `refetch` is stable and only fires on table invalidation or mount - filter
    // state changes need an explicit refetch (see useTransactionsData's spec / useLocalQuery's doc).
    useEffect(() => {
        if (localFirst) {
            void localQuery.refetch()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        localFirst,
        typeFilter,
        tagFilter,
        searchQuery,
        dateFilterActive,
        startDate,
        endDate,
        sortBy,
        sortOrder,
        activeWorkspaceId,
    ])

    const fullLocalItems = useMemo(
        () => (localQuery.data ?? []).map((tx) => toApiTransaction(tx, tx.currency ?? 'USD')),
        [localQuery.data]
    )

    const localPagination = usePaginatedList(fullLocalItems, pageSize)

    const createTransactionLocal = useCallback(
        async (payload: Record<string, unknown>): Promise<Transaction | null> => {
            if (!user) throw new Error('Not authenticated')
            const {
                type,
                title,
                amount,
                date,
                accountId,
                description,
                categoryId,
                splits,
                source,
                paymentMethod,
                tags,
            } = payload as {
                type: 'income' | 'expense'
                title: string
                amount: number
                date: string
                accountId: string
                description?: string
                categoryId?: string
                splits?: { categoryId: string; amount: number }[]
                source?: string
                paymentMethod?: string
                tags?: string[]
            }

            const db = await getLocalDb()

            if (Array.isArray(splits) && splits.length > 0) {
                await createLocalSplitExpense(db, {
                    userId: user._id,
                    workspaceId: activeWorkspaceId ?? null,
                    title,
                    amount,
                    date,
                    accountId,
                    description,
                    paymentMethod,
                    tags,
                    splits,
                })
                tableInvalidationBus.publish('transactions')
                tableInvalidationBus.publish('accounts')
                return null
            }

            if (isNaN(Date.parse(date))) {
                throw new Error('Invalid date format')
            }

            const amountMinor = parseAmountToMinorUnits(amount)

            let finalCategoryId = categoryId ?? ''
            let finalTags = tags

            const ruleResult = await applyLocalCategorizationRules(db, {
                title: title.trim(),
                description: description?.trim(),
                amount: amountMinor,
                accountId,
                type,
            })
            if (ruleResult) {
                finalCategoryId = ruleResult.categoryId
                finalTags = mergeTags(tags, ruleResult.tags)
            }

            const _id = generateLocalObjectId()
            const nowIso = new Date().toISOString()
            const doc: LocalTransaction = {
                _id,
                updatedAt: nowIso,
                createdAt: nowIso,
                userId: user._id,
                workspaceId: activeWorkspaceId ?? null,
                accountId,
                categoryId: finalCategoryId,
                type,
                status: 'posted',
                amount: amountMinor,
                title: title.trim(),
                description: description?.trim() || undefined,
                date: new Date(date).toISOString(),
                clearedStatus: 'pending',
                tags: finalTags,
                source: type === 'income' ? source?.trim() || undefined : undefined,
                paymentMethod: type === 'expense' ? paymentMethod?.trim() || undefined : undefined,
                splitTransactionId: null,
            }

            await db.transaction(async (tx) => {
                await transactionsRepo.create(tx, doc)
                await persistAccountBalance(tx, accountId)
            })
            tableInvalidationBus.publish('transactions')
            tableInvalidationBus.publish('accounts')
            return null
        },
        [user, activeWorkspaceId]
    )

    const updateTransactionLocal = useCallback(
        async (transactionId: string, payload: Record<string, unknown>): Promise<void> => {
            const { title, amount, description, categoryId, date, accountId, type, source, paymentMethod, tags } =
                payload as {
                    title?: string
                    amount?: number
                    description?: string
                    categoryId?: string
                    date?: string
                    accountId?: string
                    type?: 'income' | 'expense'
                    source?: string
                    paymentMethod?: string
                    tags?: string[]
                }

            const db = await getLocalDb()
            let oldAccountId = ''
            let newAccountId = ''

            await db.transaction(async (tx) => {
                const existing = await transactionsRepo.findById(tx, transactionId)
                if (!existing) throw new Error('Transaction not found')
                if (existing.type === 'transfer') throw new Error('Transfer editing is not available')
                if (existing.splitTransactionId) throw new Error('Split lines cannot be edited directly')

                oldAccountId = existing.accountId
                newAccountId = accountId ?? existing.accountId

                const updated: LocalTransaction = {
                    ...existing,
                    title: title !== undefined ? title.trim() : existing.title,
                    amount: amount !== undefined ? parseAmountToMinorUnits(amount) : existing.amount,
                    description: description !== undefined ? description.trim() || undefined : existing.description,
                    categoryId: categoryId !== undefined ? categoryId : existing.categoryId,
                    date: date !== undefined ? new Date(date).toISOString() : existing.date,
                    accountId: newAccountId,
                    type: type !== undefined ? type : existing.type,
                    source: source !== undefined ? source.trim() || undefined : existing.source,
                    paymentMethod: paymentMethod !== undefined ? paymentMethod.trim() || undefined : existing.paymentMethod,
                    tags: tags !== undefined ? tags : existing.tags,
                    updatedAt: new Date().toISOString(),
                }

                await transactionsRepo.update(tx, updated, existing.updatedAt)
                await persistAccountBalance(tx, oldAccountId)
                if (newAccountId !== oldAccountId) {
                    await persistAccountBalance(tx, newAccountId)
                }
            })

            tableInvalidationBus.publish('transactions')
            tableInvalidationBus.publish('accounts')
        },
        []
    )

    const deleteTransactionLocal = useCallback(async (transaction: Transaction): Promise<void> => {
        const db = await getLocalDb()
        const accountIdsToRecompute = new Set<string>()

        await db.transaction(async (tx) => {
            const existing = await transactionsRepo.findById(tx, transaction._id)
            if (!existing) throw new Error('Transaction not found')

            if (existing.type === 'transfer' && existing.transferPairId) {
                const pair = await transactionsRepo.findById(tx, existing.transferPairId)
                await transactionsRepo.remove(tx, existing._id)
                accountIdsToRecompute.add(existing.accountId)
                if (pair) {
                    await transactionsRepo.remove(tx, pair._id)
                    accountIdsToRecompute.add(pair.accountId)
                }
            } else {
                const all = await transactionsRepo.list(tx)
                const children = all.filter((candidate) => candidate.splitTransactionId === existing._id)
                for (const child of children) {
                    await transactionsRepo.remove(tx, child._id)
                }
                await transactionsRepo.remove(tx, existing._id)
                accountIdsToRecompute.add(existing.accountId)
            }

            for (const accountId of accountIdsToRecompute) {
                await persistAccountBalance(tx, accountId)
            }
        })

        tableInvalidationBus.publish('transactions')
        tableInvalidationBus.publish('accounts')
    }, [])

    const createTransferLocal = useCallback(
        async (payload: Record<string, unknown>): Promise<void> => {
            if (!user) throw new Error('Not authenticated')
            const { title, amount, date, fromAccountId, toAccountId, description } = payload as {
                title?: string
                amount: number
                date: string
                fromAccountId: string
                toAccountId: string
                description?: string
            }

            const db = await getLocalDb()
            await createLocalTransfer(db, {
                userId: user._id,
                workspaceId: activeWorkspaceId ?? null,
                title,
                amount,
                date,
                fromAccountId,
                toAccountId,
                description,
            })
            tableInvalidationBus.publish('transactions')
            tableInvalidationBus.publish('accounts')
        },
        [user, activeWorkspaceId]
    )

    const bulkDeleteLocal = useCallback(async (transactionIds: string[]): Promise<{ message: string }> => {
        const db = await getLocalDb()
        const accountIdsToRecompute = new Set<string>()
        const removedIds = new Set<string>()

        await db.transaction(async (tx) => {
            const all = await transactionsRepo.list(tx)
            const byId = new Map(all.map((candidate) => [candidate._id, candidate]))

            const removeOne = async (candidate: LocalTransaction) => {
                if (removedIds.has(candidate._id)) return
                await transactionsRepo.remove(tx, candidate._id)
                removedIds.add(candidate._id)
                accountIdsToRecompute.add(candidate.accountId)
            }

            for (const id of transactionIds) {
                const existing = byId.get(id)
                if (!existing || removedIds.has(id)) continue

                if (existing.type === 'transfer' && existing.transferPairId) {
                    const pair = byId.get(existing.transferPairId)
                    await removeOne(existing)
                    if (pair) await removeOne(pair)
                } else {
                    const children = all.filter((candidate) => candidate.splitTransactionId === existing._id)
                    for (const child of children) await removeOne(child)
                    await removeOne(existing)
                }
            }

            for (const accountId of accountIdsToRecompute) {
                await persistAccountBalance(tx, accountId)
            }
        })

        tableInvalidationBus.publish('transactions')
        tableInvalidationBus.publish('accounts')

        const deletedCount = removedIds.size
        return { message: `${deletedCount} transaction${deletedCount === 1 ? '' : 's'} deleted` }
    }, [])

    const bulkChangeCategoryLocal = useCallback(
        async (transactionIds: string[], categoryId: string): Promise<{ message: string }> => {
            const db = await getLocalDb()
            let updatedCount = 0

            await db.transaction(async (tx) => {
                for (const id of transactionIds) {
                    const existing = await transactionsRepo.findById(tx, id)
                    if (!existing || existing.type === 'transfer' || existing.splitTransactionId) continue
                    if (existing.categoryId === categoryId) continue
                    await transactionsRepo.update(
                        tx,
                        { ...existing, categoryId, updatedAt: new Date().toISOString() },
                        existing.updatedAt
                    )
                    updatedCount += 1
                }
            })

            tableInvalidationBus.publish('transactions')
            return { message: `${updatedCount} transaction${updatedCount === 1 ? '' : 's'} updated` }
        },
        []
    )

    if (!localFirst) {
        return {
            data: serverQuery.data,
            loading: serverQuery.loading,
            error: serverQuery.error,
            refetch: serverQuery.refetch,
            onPageChange: setPage,
            createTransaction: async (payload) => {
                const response = await axiosInstance.post<ApiResponse<Transaction>>(
                    API_PATHS.TRANSACTIONS.CREATE,
                    payload
                )
                return unwrapApiData(response)
            },
            updateTransaction: async (transactionId, payload) => {
                await axiosInstance.put(API_PATHS.TRANSACTIONS.UPDATE(transactionId), payload)
            },
            deleteTransaction: async (transaction) => {
                await axiosInstance.delete(API_PATHS.TRANSACTIONS.DELETE(transaction._id))
            },
            createTransfer: async (payload) => {
                await axiosInstance.post(API_PATHS.TRANSACTIONS.TRANSFER, payload)
            },
            bulkDeleteTransactions: async (transactionIds) => {
                const response = await axiosInstance.post<ApiResponse<BulkDeleteResponse>>(
                    API_PATHS.TRANSACTIONS.BULK_DELETE,
                    { transactionIds }
                )
                return unwrapApiData(response)
            },
            bulkChangeCategory: async (transactionIds, categoryId) => {
                const response = await axiosInstance.patch<ApiResponse<BulkCategoryResponse>>(
                    API_PATHS.TRANSACTIONS.BULK_CATEGORY,
                    { transactionIds, categoryId }
                )
                return unwrapApiData(response)
            },
        }
    }

    const meta: PaginationMeta = {
        pageNumber: localPagination.page,
        totalPages: localPagination.totalPages,
        limit: pageSize,
        totalTransactions: localPagination.totalItems,
    }

    return {
        data: { items: localPagination.paginatedItems, meta, mode: 'list' },
        loading: localQuery.loading,
        error: localQuery.error,
        refetch: localQuery.refetch,
        onPageChange: localPagination.setPage,
        createTransaction: createTransactionLocal,
        updateTransaction: updateTransactionLocal,
        deleteTransaction: deleteTransactionLocal,
        createTransfer: createTransferLocal,
        bulkDeleteTransactions: bulkDeleteLocal,
        bulkChangeCategory: bulkChangeCategoryLocal,
    }
}
