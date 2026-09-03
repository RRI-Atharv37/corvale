import { useCallback } from 'react'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { useAsyncData } from '@/app/hooks/useAsyncData'
import { useLocalQuery } from '@platform/db/useLocalQuery'
import { getLocalDb } from '@platform/db/localDbInstance'
import { tableInvalidationBus } from '@lib/tableInvalidationBus'
import { Repository } from '@platform/db/repositories/Repository'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import { computeLocalSubscriptions } from '@domain/subscriptions'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'
import { buildWorkspaceQueryParams } from '@lib/workspaceScope'
import { useWorkspace } from '@/app/providers/useWorkspace'
import type { ApiResponse } from '@lib/types/api'
import type { SubscriptionsResponse } from '@features/subscriptions/types'
import type { LocalRecurringRule } from '@domain/types'
import type { LocalDb } from '@platform/db/LocalDb'

const recurringRepo = new Repository<LocalRecurringRule>('recurringRules')

export interface UseSubscriptionsDataResult {
    data: SubscriptionsResponse | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
    toggleCancelled: (ruleId: string, isCancelled: boolean) => Promise<void>
}

/**
 * Data layer for the Subscriptions dashboard page (Sprint 13.10). Branches on
 * `isLocalFirstEnabled()`: the server branch is the page's pre-existing `useAsyncData` + axios
 * code, relocated verbatim; the local branch derives the subscription list over the local SQLite
 * store via `domain/subscriptions.ts`'s `computeLocalSubscriptions`, orchestrated the same way
 * `backend/controllers/subscriptionController.ts` does. Cancel/reactivate writes through
 * `recurringRules` via `Repository.update` exactly like `useRecurringData.ts`'s
 * `toggleRuleActive` - workspace-scoped writes are blocked offline automatically by
 * `Outbox.enqueue` (Sprint 13.6), no extra gating needed here.
 */
export const useSubscriptionsData = (): UseSubscriptionsDataResult => {
    const { activeWorkspaceId } = useWorkspace()
    const localFirst = isLocalFirstEnabled()

    const fetchSubscriptions = useCallback(async (): Promise<SubscriptionsResponse> => {
        if (localFirst) return { subscriptions: [], totalMonthlyCost: 0, totalAnnualCost: 0 }
        try {
            const response = await axiosInstance.get<ApiResponse<SubscriptionsResponse>>(
                API_PATHS.SUBSCRIPTIONS.GET_ALL,
                { params: buildWorkspaceQueryParams(activeWorkspaceId) }
            )
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load subscriptions'))
        }
    }, [activeWorkspaceId, localFirst])

    const serverQuery = useAsyncData(fetchSubscriptions, [fetchSubscriptions])

    const localFetcher = useCallback(
        async (db: LocalDb): Promise<SubscriptionsResponse> =>
            computeLocalSubscriptions(db, { workspaceId: activeWorkspaceId ?? null }),
        [activeWorkspaceId]
    )

    const localQuery = useLocalQuery<SubscriptionsResponse>('recurringRules', localFetcher)

    if (!localFirst) {
        return {
            data: serverQuery.data,
            loading: serverQuery.loading,
            error: serverQuery.error,
            refetch: serverQuery.refetch,
            toggleCancelled: async (ruleId, isCancelled) => {
                await axiosInstance.put(API_PATHS.RECURRING_RULES.UPDATE(ruleId), { isCancelled: !isCancelled })
                await serverQuery.refetch()
            },
        }
    }

    return {
        data: localQuery.data,
        loading: localQuery.loading,
        error: localQuery.error,
        refetch: localQuery.refetch,
        toggleCancelled: async (ruleId) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await recurringRepo.findById(tx, ruleId)
                if (!existing) throw new Error('Recurring rule not found locally')
                await recurringRepo.update(tx, { ...existing, isCancelled: !existing.isCancelled }, existing.updatedAt)
            })
            tableInvalidationBus.publish('recurringRules')
        },
    }
}
