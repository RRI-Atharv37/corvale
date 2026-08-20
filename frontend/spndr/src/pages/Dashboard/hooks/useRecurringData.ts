import { useCallback } from 'react'
import { toMinorUnits, fromMinorUnits } from '@shared/money'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'
import { useAsyncData } from '../../../hooks/useAsyncData'
import { useLocalQuery } from '../../../db/useLocalQuery'
import { getLocalDb } from '../../../db/localDbInstance'
import { tableInvalidationBus } from '../../../db/invalidation/tableInvalidationBus'
import { Repository } from '../../../db/repositories/Repository'
import { generateLocalObjectId } from '../../../db/generateLocalId'
import { isLocalFirstEnabled } from '../../../utils/localFirstFlag'
import { unwrapApiData } from '../../../utils/apiHelpers'
import { getApiErrorMessage } from '../../../utils/apiError'
import { useUser } from '../../../hooks/useUser'
import { useWorkspace } from '../../../hooks/useWorkspace'
import type { ApiResponse, RecurringInterval, RecurringRule, RecurringRuleType } from '../../../types/api'
import type { LocalRecurringRule } from '../../../domain/types'
import type { LocalDb } from '../../../db/LocalDb'

const recurringRepo = new Repository<LocalRecurringRule>('recurringRules')

/**
 * Form-shaped input for both create and update - matches what `Recurring.tsx`'s `buildPayload`
 * already validates and produces. `amount` is major units (what the amount input field holds);
 * conversion to/from the local store's minor-unit convention happens inside this hook.
 */
export interface RecurringRuleInput {
    title: string
    type: RecurringRuleType
    amount: number
    currency: string
    accountId: string
    categoryId: string
    interval: RecurringInterval
    customIntervalDays?: number
    nextDueDate: string
    description?: string
    paymentMethod?: string
    tags: string[]
    isActive: boolean
}

export interface UseRecurringDataResult {
    rules: RecurringRule[] | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
    createRule: (input: RecurringRuleInput) => Promise<void>
    updateRule: (rule: RecurringRule, input: RecurringRuleInput) => Promise<void>
    archiveRule: (rule: RecurringRule) => Promise<void>
    toggleRuleActive: (rule: RecurringRule) => Promise<void>
}

/**
 * `LocalRecurringRule.amount` mirrors the raw DB value shipped by `/sync/bootstrap`/`/sync/pull`
 * (`docs.map((doc) => doc.toObject())` in `backend/services/syncService.ts` - no serialization), so
 * it is minor units like `LocalTransaction.amount`, not the major-unit value the REST
 * `GET /recurring-rules` response carries after `serializeRecurringRule`'s `fromMinorUnits` step.
 */
const toRuleView = (rule: LocalRecurringRule): RecurringRule => ({
    _id: rule._id,
    userId: rule.userId,
    workspaceId: rule.workspaceId,
    title: rule.title,
    type: rule.type,
    amount: fromMinorUnits(rule.amount),
    currency: rule.currency,
    accountId: rule.accountId,
    categoryId: rule.categoryId,
    interval: rule.interval,
    customIntervalDays: rule.customIntervalDays,
    nextDueDate: rule.nextDueDate,
    description: rule.description,
    paymentMethod: rule.paymentMethod,
    tags: rule.tags,
    isActive: rule.isActive,
    isArchived: rule.isArchived,
    isCancelled: rule.isCancelled,
    updatedAt: rule.updatedAt,
})

const buildRestPayload = (input: RecurringRuleInput): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
        title: input.title,
        type: input.type,
        amount: input.amount,
        currency: input.currency,
        accountId: input.accountId,
        categoryId: input.categoryId,
        interval: input.interval,
        nextDueDate: input.nextDueDate,
        description: input.description,
        paymentMethod: input.paymentMethod,
        tags: input.tags,
        isActive: input.isActive,
    }
    if (input.interval === 'custom') {
        payload.customIntervalDays = input.customIntervalDays
    }
    return payload
}

/**
 * Data layer for the Recurring dashboard page's rule CRUD (Sprint 13.9). Branches on
 * `isLocalFirstEnabled()`: the server branch is the page's pre-existing `useAsyncData` + axios
 * code, relocated verbatim; the local branch reads/writes through the local SQLite store via
 * `Repository`/`useLocalQuery`. Draft generation/confirm/dismiss stay out of this hook entirely -
 * see `useRecurringDrafts.ts` - per ROADMAP.md's "Server-authoritative" decision.
 */
export const useRecurringData = (): UseRecurringDataResult => {
    const { user } = useUser()
    const { activeWorkspaceId } = useWorkspace()
    const localFirst = isLocalFirstEnabled()

    // `useAsyncData` must still be called unconditionally (rules of hooks) even when local-first is
    // on and its result is discarded below - guard the fetcher itself so no real network request
    // goes out in that case (mirrors `useDashboardSummaryData.ts`'s `localFirst` guard).
    const fetchRules = useCallback(async (): Promise<RecurringRule[]> => {
        if (localFirst) return []
        try {
            const response = await axiosInstance.get<ApiResponse<RecurringRule[]>>(
                API_PATHS.RECURRING_RULES.GET_ALL,
                { params: { includeArchived: 'true' } }
            )
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load recurring rules'))
        }
    }, [localFirst])

    const serverQuery = useAsyncData(fetchRules, [fetchRules])

    const localFetcher = useCallback(async (db: LocalDb): Promise<RecurringRule[]> => {
        const rows = await recurringRepo.list(db)
        return rows.map(toRuleView)
    }, [])

    const localQuery = useLocalQuery<RecurringRule[]>('recurringRules', localFetcher)

    if (!localFirst) {
        return {
            rules: serverQuery.data,
            loading: serverQuery.loading,
            error: serverQuery.error,
            refetch: serverQuery.refetch,
            createRule: async (input) => {
                await axiosInstance.post(API_PATHS.RECURRING_RULES.CREATE, buildRestPayload(input))
                await serverQuery.refetch()
            },
            updateRule: async (rule, input) => {
                await axiosInstance.put(API_PATHS.RECURRING_RULES.UPDATE(rule._id), buildRestPayload(input))
                await serverQuery.refetch()
            },
            archiveRule: async (rule) => {
                await axiosInstance.delete(API_PATHS.RECURRING_RULES.DELETE(rule._id))
                await serverQuery.refetch()
            },
            toggleRuleActive: async (rule) => {
                await axiosInstance.put(API_PATHS.RECURRING_RULES.UPDATE(rule._id), { isActive: !rule.isActive })
                await serverQuery.refetch()
            },
        }
    }

    return {
        rules: localQuery.data,
        loading: localQuery.loading,
        error: localQuery.error,
        refetch: localQuery.refetch,
        createRule: async (input) => {
            if (!user) throw new Error('Not authenticated')
            const db = await getLocalDb()
            const doc: LocalRecurringRule = {
                _id: generateLocalObjectId(),
                updatedAt: new Date().toISOString(),
                userId: user._id,
                workspaceId: activeWorkspaceId ?? null,
                title: input.title,
                type: input.type,
                amount: toMinorUnits(input.amount),
                currency: input.currency,
                accountId: input.accountId,
                categoryId: input.categoryId,
                interval: input.interval,
                customIntervalDays: input.interval === 'custom' ? input.customIntervalDays : undefined,
                nextDueDate: input.nextDueDate,
                description: input.description,
                paymentMethod: input.paymentMethod,
                tags: input.tags,
                isActive: input.isActive,
                isArchived: false,
                isCancelled: false,
            }
            await db.transaction(async (tx) => {
                await recurringRepo.create(tx, doc)
            })
            tableInvalidationBus.publish('recurringRules')
        },
        updateRule: async (rule, input) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await recurringRepo.findById(tx, rule._id)
                if (!existing) throw new Error('Recurring rule not found locally')
                const updated: LocalRecurringRule = {
                    ...existing,
                    title: input.title,
                    type: input.type,
                    amount: toMinorUnits(input.amount),
                    currency: input.currency,
                    accountId: input.accountId,
                    categoryId: input.categoryId,
                    interval: input.interval,
                    customIntervalDays: input.interval === 'custom' ? input.customIntervalDays : undefined,
                    nextDueDate: input.nextDueDate,
                    description: input.description,
                    paymentMethod: input.paymentMethod,
                    tags: input.tags,
                    isActive: input.isActive,
                }
                await recurringRepo.update(tx, updated, existing.updatedAt)
            })
            tableInvalidationBus.publish('recurringRules')
        },
        archiveRule: async (rule) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await recurringRepo.findById(tx, rule._id)
                if (!existing) throw new Error('Recurring rule not found locally')
                // `recurringRules` has no `deletedAt` - only `isArchived`, mirroring
                // `archiveRecurringRule` in `backend/controllers/recurringRuleController.ts`, which
                // also clears `isActive` on archive.
                await recurringRepo.update(tx, { ...existing, isArchived: true, isActive: false }, existing.updatedAt)
            })
            tableInvalidationBus.publish('recurringRules')
        },
        toggleRuleActive: async (rule) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await recurringRepo.findById(tx, rule._id)
                if (!existing) throw new Error('Recurring rule not found locally')
                await recurringRepo.update(tx, { ...existing, isActive: !existing.isActive }, existing.updatedAt)
            })
            tableInvalidationBus.publish('recurringRules')
        },
    }
}
