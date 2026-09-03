import { useCallback } from 'react'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { useAsyncData } from '@/app/hooks/useAsyncData'
import { useLocalQuery } from '@platform/db/useLocalQuery'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import { computeLocalDashboardSummary, type DashboardSummary as LocalDashboardSummary } from '@domain/dashboard'
import { useUser } from '@/app/providers/useUser'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'
import type { ApiResponse, DashboardSummary as ServerDashboardSummary } from '@lib/types/api'

interface PeriodQuery {
    startDate: string
    endDate: string
}

/** The full server `DashboardSummary` (types/api.ts) is a strict superset of the local domain one - Home.tsx only reads the fields both share. */
interface UseDashboardSummaryDataResult {
    data: LocalDashboardSummary | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
}

const fetchServerSummary = async (periodQuery: PeriodQuery): Promise<ServerDashboardSummary> => {
    try {
        const summaryRes = await axiosInstance.get<ApiResponse<ServerDashboardSummary>>(API_PATHS.DASHBOARD.SUMMARY, {
            params: periodQuery,
        })
        return unwrapApiData(summaryRes)
    } catch (error) {
        throw new Error(getApiErrorMessage(error, 'Failed to load dashboard'))
    }
}

/**
 * `Home.tsx`'s data layer, split local-first vs. server per Sprint 13.9.
 * `computeLocalDashboardSummary` (domain/dashboard.ts, Sprint 13.5) already
 * computes the exact same `DashboardSummary` shape the server returns, so
 * this is a straight swap - no new domain logic needed.
 */
export const useDashboardSummaryData = (periodQuery: PeriodQuery): UseDashboardSummaryDataResult => {
    const { user } = useUser()
    const localFirst = isLocalFirstEnabled()

    const localResult = useLocalQuery(
        ['accounts', 'transactions', 'categories', 'budgets', '_prefs'],
        useCallback(
            (db) =>
                computeLocalDashboardSummary(db, periodQuery.startDate, periodQuery.endDate, user?.timezone || 'UTC', {
                    preferredCurrency: user?.preferredCurrency ?? 'USD',
                    exchangeRates: user?.exchangeRates ?? {},
                }),
            [periodQuery.startDate, periodQuery.endDate, user?.timezone, user?.preferredCurrency, user?.exchangeRates]
        )
    )

    // `useAsyncData` must still be called unconditionally (rules of hooks) even
    // when local-first is on and its result is discarded below - guard the
    // fetcher itself so no real network request goes out in that case.
    const serverResult = useAsyncData(
        useCallback(
            () => (localFirst ? Promise.resolve(null as unknown as ServerDashboardSummary) : fetchServerSummary(periodQuery)),
            [localFirst, periodQuery]
        ),
        [periodQuery, localFirst]
    )

    return localFirst ? localResult : serverResult
}
