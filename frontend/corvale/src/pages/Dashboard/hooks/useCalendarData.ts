import { useCallback, useEffect } from 'react'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'
import { useAsyncData } from '../../../hooks/useAsyncData'
import { useLocalQuery } from '../../../db/useLocalQuery'
import { isLocalFirstEnabled } from '../../../utils/localFirstFlag'
import { computeLocalCalendar } from '../../../domain/calendar'
import { unwrapApiData } from '../../../utils/apiHelpers'
import { getApiErrorMessage } from '../../../utils/apiError'
import { buildWorkspaceQueryParams } from '../../../utils/workspaceScope'
import { useUser } from '../../../hooks/useUser'
import { useWorkspace } from '../../../hooks/useWorkspace'
import type { ApiResponse, CalendarEvent } from '../../../types/api'
import type { LocalDb } from '../../../db/LocalDb'

export interface UseCalendarDataResult {
    events: CalendarEvent[] | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
}

/**
 * Data layer for the Calendar dashboard page (Sprint 13.10). Branches on `isLocalFirstEnabled()`:
 * the server branch is the page's pre-existing `useAsyncData` + axios code, relocated verbatim;
 * the local branch computes the merged event list over the local SQLite store via
 * `domain/calendar.ts`'s `computeLocalCalendar`, orchestrated the same way
 * `backend/controllers/calendarController.ts` does.
 */
export const useCalendarData = (rangeStart: string, rangeEnd: string): UseCalendarDataResult => {
    const { user } = useUser()
    const { activeWorkspaceId } = useWorkspace()
    const localFirst = isLocalFirstEnabled()

    const fetchEvents = useCallback(async (): Promise<CalendarEvent[]> => {
        if (localFirst) return []
        try {
            const response = await axiosInstance.get<ApiResponse<CalendarEvent[]>>(API_PATHS.CALENDAR.GET, {
                params: {
                    start: rangeStart,
                    end: rangeEnd,
                    ...buildWorkspaceQueryParams(activeWorkspaceId),
                },
            })
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load calendar'))
        }
    }, [rangeStart, rangeEnd, activeWorkspaceId, localFirst])

    const serverQuery = useAsyncData(fetchEvents, [fetchEvents])

    const localFetcher = useCallback(
        async (db: LocalDb): Promise<CalendarEvent[]> =>
            computeLocalCalendar(db, {
                start: rangeStart,
                end: rangeEnd,
                timezone: user?.timezone?.trim() || 'UTC',
                workspaceId: activeWorkspaceId ?? null,
            }),
        [rangeStart, rangeEnd, user?.timezone, activeWorkspaceId]
    )

    const localQuery = useLocalQuery<CalendarEvent[]>(['recurringRules', 'budgets', 'savingsGoals'], localFetcher)

    // `useLocalQuery` only refetches on table invalidation or mount - it has no dependency on
    // `rangeStart`/`rangeEnd`/`activeWorkspaceId`, so navigating months needs an explicit refetch.
    useEffect(() => {
        if (localFirst) {
            void localQuery.refetch()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rangeStart, rangeEnd, activeWorkspaceId, localFirst])

    if (!localFirst) {
        return {
            events: serverQuery.data,
            loading: serverQuery.loading,
            error: serverQuery.error,
            refetch: serverQuery.refetch,
        }
    }

    return {
        events: localQuery.data,
        loading: localQuery.loading,
        error: localQuery.error,
        refetch: localQuery.refetch,
    }
}
