import { useCallback, useEffect } from 'react'
import { fromMinorUnits, toMinorUnits } from '@shared/money'
import { resolveCustomPeriod, resolveMonthlyPeriod } from '@shared/budget'
import { DEFAULT_TIMEZONE } from '@shared/timezone'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { useAsyncData } from '@/app/hooks/useAsyncData'
import { useLocalQuery } from '@platform/db/useLocalQuery'
import { getLocalDb } from '@platform/db/localDbInstance'
import { tableInvalidationBus } from '@lib/tableInvalidationBus'
import { Repository } from '@platform/db/repositories/Repository'
import { generateLocalObjectId } from '@platform/db/generateLocalId'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import { listLocalBudgetsWithProgress } from '@domain/budgetProgress'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'
import { buildWorkspaceBodyFields, buildWorkspaceQueryParams } from '@lib/workspaceScope'
import { useUser } from '@/app/providers/useUser'
import { useWorkspace } from '@/app/providers/useWorkspace'
import { useCategoriesData } from '@features/categories/hooks/useCategoriesData'
import type { Account, ApiResponse, Budget, BudgetPeriodType, CategoriesResponse } from '@lib/types/api'
import type { LocalAccount, LocalBudget } from '@domain/types'
import type { LocalDb } from '@platform/db/LocalDb'

/** `LocalBudget` (domain/types.ts) has no `periodType`/`currency`/`rollover` fields yet - they
 * round-trip fine through the JSON `data` blob (Repository stores the full doc), this just widens
 * the local type so this hook can read/write them without touching shared infra. */
interface LocalBudgetRecord extends LocalBudget {
    periodType: BudgetPeriodType
    currency: string
    rollover: boolean
}

const budgetsRepo = new Repository<LocalBudgetRecord>('budgets')
const accountsRepo = new Repository<LocalAccount>('accounts')

export type BudgetView = 'active' | 'history'

/** Mirrors exactly what `Budgets.tsx`'s `buildPayload` already sends to `POST/PUT /budgets` -
 * `year`/`month` are set for monthly budgets, `periodStart`/`periodEnd` for custom ones. Amounts
 * are major units (the page's form values), matching the server's request body contract. */
export interface BudgetPayload {
    name?: string
    periodType: BudgetPeriodType
    amount: number
    currency: string
    rollover: boolean
    categoryId: string | null
    accountIds: string[]
    year?: number
    month?: number
    periodStart?: string
    periodEnd?: string
}

export interface UseBudgetsDataResult {
    budgets: Budget[] | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
    categories: CategoriesResponse | null
    accounts: Account[] | null
    createBudget: (payload: BudgetPayload) => Promise<void>
    updateBudget: (budget: Budget, payload: BudgetPayload) => Promise<void>
    archiveBudget: (budget: Budget) => Promise<void>
}

const toBudgetView = (
    budget: LocalBudgetRecord & { progress: Budget['progress'] }
): Budget => ({
    _id: budget._id,
    userId: budget.userId,
    workspaceId: budget.workspaceId ?? null,
    name: budget.name,
    periodType: budget.periodType,
    periodStart: budget.periodStart,
    periodEnd: budget.periodEnd,
    categoryId: budget.categoryId,
    amount: fromMinorUnits(budget.amount),
    currency: budget.currency,
    rollover: budget.rollover,
    accountIds: budget.accountIds ?? [],
    isArchived: budget.isArchived,
    progress: budget.progress,
    updatedAt: budget.updatedAt,
})

const toAccountView = (account: LocalAccount): Account => ({
    _id: account._id,
    userId: account.userId,
    workspaceId: account.workspaceId ?? null,
    name: account.name,
    type: account.type,
    currency: account.currency,
    openingBalance: account.openingBalance ?? account.currentBalance,
    currentBalance: account.currentBalance,
    isDefault: false,
    isArchived: account.isArchived,
    updatedAt: account.updatedAt,
})

/** Timezone-aware period resolution mirroring `resolvePeriodFromBody` in
 * `backend/controllers/budgetController.ts`, reusing the same `shared/` functions the server
 * calls so a locally-created budget's `periodStart`/`periodEnd` match what the server would have
 * computed for the same form inputs. */
const resolveLocalPeriod = (
    payload: BudgetPayload,
    timezone: string
): { periodStart: string; periodEnd: string } => {
    if (payload.periodType === 'monthly') {
        if (payload.year === undefined || payload.month === undefined) {
            throw new Error('Year and month are required for a monthly budget')
        }
        const { periodStart, periodEnd } = resolveMonthlyPeriod(payload.year, payload.month, timezone)
        return { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() }
    }

    if (payload.periodStart === undefined || payload.periodEnd === undefined) {
        throw new Error('Start and end dates are required for a custom budget')
    }
    const { periodStart, periodEnd } = resolveCustomPeriod(payload.periodStart, payload.periodEnd, timezone)
    return { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() }
}

/**
 * Data layer for the Budgets dashboard page (Sprint 13.9). Branches on `isLocalFirstEnabled()`:
 * the server branch is the page's pre-existing `useAsyncData` + axios code, relocated verbatim;
 * the local branch reads/writes through the local SQLite store via `Repository`/`useLocalQuery`,
 * and the create/update/archive mutations mirror `resolveLocalPeriod` above plus the "archive
 * writes isArchived via an update op, never `repo.remove()`" rule (`budgets` has no `deletedAt`).
 */
export const useBudgetsData = (view: BudgetView): UseBudgetsDataResult => {
    const { user } = useUser()
    const { activeWorkspaceId } = useWorkspace()
    const localFirst = isLocalFirstEnabled()
    // `useCategoriesData` (Sprint 13.9, same folder) already branches on `isLocalFirstEnabled()`
    // for `GET /categories` with no params, which is exactly what this page's own category fetch
    // needs (no workspace scoping) - reused here instead of duplicating it.
    const categoriesData = useCategoriesData()

    const fetchBudgets = useCallback(async (): Promise<Budget[]> => {
        try {
            const response = await axiosInstance.get<ApiResponse<Budget[]>>(API_PATHS.BUDGETS.GET_ALL, {
                params: {
                    includeArchived: view === 'history' ? 'true' : 'false',
                    ...buildWorkspaceQueryParams(activeWorkspaceId),
                },
            })
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load budgets'))
        }
    }, [view, activeWorkspaceId])

    const serverQuery = useAsyncData(fetchBudgets, [fetchBudgets])

    const localFetcher = useCallback(async (db: LocalDb): Promise<Budget[]> => {
        const withProgress = await listLocalBudgetsWithProgress(db)
        return (withProgress as Array<LocalBudgetRecord & { progress: Budget['progress'] }>).map(toBudgetView)
    }, [])

    const localQuery = useLocalQuery<Budget[]>(['budgets', 'transactions', '_prefs'], localFetcher)

    const fetchAccounts = useCallback(async (): Promise<Account[]> => {
        const response = await axiosInstance.get<ApiResponse<Account[]>>(API_PATHS.ACCOUNTS.GET_ALL, {
            params: buildWorkspaceQueryParams(activeWorkspaceId),
        })
        return unwrapApiData(response).filter((account) => !account.isArchived)
    }, [activeWorkspaceId])

    const serverAccountsQuery = useAsyncData(fetchAccounts, [fetchAccounts])

    const localAccountsFetcher = useCallback(
        async (db: LocalDb): Promise<Account[]> => {
            const rows = await accountsRepo.list(db)
            return rows
                .filter((account) => !account.isArchived)
                .filter((account) => (activeWorkspaceId ? account.workspaceId === activeWorkspaceId : !account.workspaceId))
                .map(toAccountView)
        },
        [activeWorkspaceId]
    )

    const localAccountsQuery = useLocalQuery<Account[]>('accounts', localAccountsFetcher)

    // `useLocalQuery` only refetches on table invalidation or mount - it has no dependency on
    // `activeWorkspaceId`, so switching workspaces needs an explicit refetch to re-run the filter.
    useEffect(() => {
        if (localFirst) {
            void localAccountsQuery.refetch()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeWorkspaceId, localFirst])

    if (!localFirst) {
        return {
            budgets: serverQuery.data,
            loading: serverQuery.loading,
            error: serverQuery.error,
            refetch: serverQuery.refetch,
            categories: categoriesData.categories,
            accounts: serverAccountsQuery.data,
            createBudget: async (payload) => {
                await axiosInstance.post(API_PATHS.BUDGETS.CREATE, {
                    ...payload,
                    ...buildWorkspaceBodyFields(activeWorkspaceId),
                })
                await serverQuery.refetch()
            },
            updateBudget: async (budget, payload) => {
                await axiosInstance.put(API_PATHS.BUDGETS.UPDATE(budget._id), payload)
                await serverQuery.refetch()
            },
            archiveBudget: async (budget) => {
                await axiosInstance.delete(API_PATHS.BUDGETS.DELETE(budget._id))
                await serverQuery.refetch()
            },
        }
    }

    return {
        budgets: localQuery.data,
        loading: localQuery.loading,
        error: localQuery.error,
        refetch: localQuery.refetch,
        categories: categoriesData.categories,
        accounts: localAccountsQuery.data,
        createBudget: async (payload) => {
            if (!user) throw new Error('Not authenticated')
            const db = await getLocalDb()
            const timezone = user.timezone?.trim() || DEFAULT_TIMEZONE
            const { periodStart, periodEnd } = resolveLocalPeriod(payload, timezone)
            const doc: LocalBudgetRecord = {
                _id: generateLocalObjectId(),
                updatedAt: new Date().toISOString(),
                userId: user._id,
                workspaceId: activeWorkspaceId ?? null,
                name: payload.name,
                periodType: payload.periodType,
                periodStart,
                periodEnd,
                categoryId: payload.categoryId,
                amount: toMinorUnits(payload.amount),
                currency: payload.currency,
                rollover: payload.rollover,
                accountIds: payload.accountIds,
                isArchived: false,
            }
            await db.transaction(async (tx) => {
                await budgetsRepo.create(tx, doc)
            })
            tableInvalidationBus.publish('budgets')
        },
        updateBudget: async (budget, payload) => {
            const db = await getLocalDb()
            const timezone = user?.timezone?.trim() || DEFAULT_TIMEZONE
            const { periodStart, periodEnd } = resolveLocalPeriod(payload, timezone)
            await db.transaction(async (tx) => {
                const existing = await budgetsRepo.findById(tx, budget._id)
                if (!existing) throw new Error('Budget not found')
                const updated: LocalBudgetRecord = {
                    ...existing,
                    name: payload.name,
                    periodType: payload.periodType,
                    periodStart,
                    periodEnd,
                    categoryId: payload.categoryId,
                    amount: toMinorUnits(payload.amount),
                    currency: payload.currency,
                    rollover: payload.rollover,
                    accountIds: payload.accountIds,
                }
                await budgetsRepo.update(tx, updated, existing.updatedAt)
            })
            tableInvalidationBus.publish('budgets')
        },
        archiveBudget: async (budget) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await budgetsRepo.findById(tx, budget._id)
                if (!existing) throw new Error('Budget not found')
                await budgetsRepo.update(tx, { ...existing, isArchived: true }, existing.updatedAt)
            })
            tableInvalidationBus.publish('budgets')
        },
    }
}
