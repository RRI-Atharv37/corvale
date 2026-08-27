import { useCallback, useEffect } from 'react'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'
import { useAsyncData } from '../../../hooks/useAsyncData'
import { useLocalQuery } from '../../../db/useLocalQuery'
import { isLocalFirstEnabled } from '../../../utils/localFirstFlag'
import { computeLocalForecast } from '../../../domain/forecast'
import { unwrapApiData } from '../../../utils/apiHelpers'
import { getApiErrorMessage } from '../../../utils/apiError'
import { buildWorkspaceQueryParams } from '../../../utils/workspaceScope'
import { useWorkspace } from '../../../hooks/useWorkspace'
import type { Account, ApiResponse, ForecastResponse } from '../../../types/api'
import type { LocalDb } from '../../../db/LocalDb'
import { Repository } from '../../../db/repositories/Repository'
import type { LocalAccount } from '../../../domain/types'

const accountsRepo = new Repository<LocalAccount>('accounts')

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

export interface UseForecastDataResult {
    accounts: Account[] | null
    forecast: ForecastResponse | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
}

/**
 * Data layer for the Forecast dashboard page (Sprint 13.10). Branches on `isLocalFirstEnabled()`:
 * the server branch is the page's pre-existing `useAsyncData` + axios code, relocated verbatim;
 * the local branch computes the projection over the local SQLite store via
 * `domain/forecast.ts`'s `computeLocalForecast` (Sprint 13.1's `shared/src/forecast.ts` pure
 * functions, orchestrated the same way `backend/controllers/forecastController.ts` does).
 */
export const useForecastData = (days: number, accountId: string): UseForecastDataResult => {
    const { activeWorkspaceId } = useWorkspace()
    const localFirst = isLocalFirstEnabled()

    const fetchAccounts = useCallback(async (): Promise<Account[]> => {
        if (localFirst) return []
        const response = await axiosInstance.get<ApiResponse<Account[]>>(API_PATHS.ACCOUNTS.GET_ALL, {
            params: buildWorkspaceQueryParams(activeWorkspaceId),
        })
        return unwrapApiData(response).filter((account) => !account.isArchived)
    }, [activeWorkspaceId, localFirst])

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

    const fetchForecast = useCallback(async (): Promise<ForecastResponse> => {
        if (localFirst) return null as unknown as ForecastResponse
        try {
            const response = await axiosInstance.get<ApiResponse<ForecastResponse>>(API_PATHS.FORECAST.GET, {
                params: {
                    days,
                    ...(accountId ? { accountId } : {}),
                    ...buildWorkspaceQueryParams(activeWorkspaceId),
                },
            })
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load forecast'))
        }
    }, [days, accountId, activeWorkspaceId, localFirst])

    const serverForecastQuery = useAsyncData(fetchForecast, [fetchForecast])

    const localForecastFetcher = useCallback(
        async (db: LocalDb): Promise<ForecastResponse> =>
            computeLocalForecast(db, {
                days,
                accountId: accountId || undefined,
                workspaceId: activeWorkspaceId ?? null,
            }),
        [days, accountId, activeWorkspaceId]
    )

    const localForecastQuery = useLocalQuery<ForecastResponse>(
        ['accounts', 'recurringRules', 'savingsGoals', 'transactions'],
        localForecastFetcher
    )

    // `useLocalQuery` only refetches on table invalidation or mount - it has no dependency on
    // `days`/`accountId`/`activeWorkspaceId`, so changing any of these needs an explicit refetch.
    useEffect(() => {
        if (localFirst) {
            void localAccountsQuery.refetch()
            void localForecastQuery.refetch()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [days, accountId, activeWorkspaceId, localFirst])

    if (!localFirst) {
        return {
            accounts: serverAccountsQuery.data,
            forecast: serverForecastQuery.data,
            loading: serverForecastQuery.loading,
            error: serverForecastQuery.error,
            refetch: serverForecastQuery.refetch,
        }
    }

    return {
        accounts: localAccountsQuery.data,
        forecast: localForecastQuery.data,
        loading: localForecastQuery.loading,
        error: localForecastQuery.error,
        refetch: localForecastQuery.refetch,
    }
}
