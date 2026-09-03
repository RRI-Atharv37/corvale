import { useCallback } from 'react'
import { toMinorUnits, fromMinorUnits } from '@shared/money'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { useAsyncData } from '@/app/hooks/useAsyncData'
import { useLocalQuery } from '@platform/db/useLocalQuery'
import { getLocalDb } from '@platform/db/localDbInstance'
import { tableInvalidationBus } from '@lib/tableInvalidationBus'
import { Repository } from '@platform/db/repositories/Repository'
import { generateLocalObjectId } from '@platform/db/generateLocalId'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'
import { useUser } from '@/app/providers/useUser'
import { bulkApplyLocalCategorizationRules, findMatchingLocalRule } from '@domain/categorizationRules'
import type { ApiResponse } from '@lib/types/api'
import type { CategorizationMatchType, CategorizationRule, CategorizationRuleBulkApplyResult, CategorizationRuleTestResult } from '@features/categories/types'
import type { LocalCategorizationRule } from '@domain/types'
import type { LocalDb } from '@platform/db/LocalDb'
import type { TransactionMatchInput } from '@shared/categorization'

const rulesRepo = new Repository<LocalCategorizationRule>('categorizationRules')

/** Form-shaped input for both create and update. `amountMin`/`amountMax` are major units (what the
 * form's number inputs hold); conversion to the local store's minor-unit convention happens here. */
export interface CategorizationRuleInput {
    name: string
    matchType: CategorizationMatchType
    matchValue?: string
    amountMin?: number
    amountMax?: number
    accountId?: string
    categoryId: string
    tags: string[]
    priority: number
    isActive: boolean
}

export interface UseCategorizationRulesDataResult {
    rules: CategorizationRule[] | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
    createRule: (input: CategorizationRuleInput) => Promise<void>
    updateRule: (rule: CategorizationRule, input: CategorizationRuleInput) => Promise<void>
    deleteRule: (rule: CategorizationRule) => Promise<void>
    toggleRuleActive: (rule: CategorizationRule) => Promise<void>
    bulkApply: () => Promise<CategorizationRuleBulkApplyResult>
    testRule: (input: TransactionMatchInput) => Promise<CategorizationRuleTestResult>
}

/**
 * `LocalCategorizationRule.amountMin`/`amountMax` mirror the raw DB value shipped by
 * `/sync/bootstrap`/`/sync/pull` (no serialization), so they are minor units like
 * `LocalTransaction.amount` - not the major-unit values the REST `GET /categorization-rules`
 * response carries after `serializeCategorizationRule`'s `fromMinorUnits` step.
 */
const toRuleView = (rule: LocalCategorizationRule): CategorizationRule => ({
    _id: rule._id,
    userId: rule.userId,
    name: rule.name,
    matchType: rule.matchType,
    matchValue: rule.matchValue,
    amountMin: rule.amountMin !== undefined ? fromMinorUnits(rule.amountMin) : undefined,
    amountMax: rule.amountMax !== undefined ? fromMinorUnits(rule.amountMax) : undefined,
    accountId: rule.accountId,
    categoryId: rule.categoryId,
    tags: rule.tags ?? [],
    priority: rule.priority,
    isActive: rule.isActive,
    updatedAt: rule.updatedAt,
})

const buildRestPayload = (input: CategorizationRuleInput): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
        name: input.name,
        matchType: input.matchType,
        categoryId: input.categoryId,
        tags: input.tags,
        priority: input.priority,
        isActive: input.isActive,
    }
    if (input.matchType === 'description_contains' || input.matchType === 'description_equals') {
        payload.matchValue = input.matchValue
    }
    if (input.matchType === 'amount_range') {
        if (input.amountMin !== undefined) payload.amountMin = input.amountMin
        if (input.amountMax !== undefined) payload.amountMax = input.amountMax
    }
    if (input.matchType === 'account_id') {
        payload.accountId = input.accountId
    }
    return payload
}

const buildLocalDoc = (
    input: CategorizationRuleInput,
    base: { _id: string; updatedAt: string; userId: string }
): LocalCategorizationRule => ({
    _id: base._id,
    updatedAt: base.updatedAt,
    userId: base.userId,
    name: input.name,
    matchType: input.matchType,
    matchValue:
        input.matchType === 'description_contains' || input.matchType === 'description_equals'
            ? input.matchValue
            : undefined,
    amountMin:
        input.matchType === 'amount_range' && input.amountMin !== undefined
            ? toMinorUnits(input.amountMin)
            : undefined,
    amountMax:
        input.matchType === 'amount_range' && input.amountMax !== undefined
            ? toMinorUnits(input.amountMax)
            : undefined,
    accountId: input.matchType === 'account_id' ? input.accountId : undefined,
    categoryId: input.categoryId,
    tags: input.tags,
    priority: input.priority,
    isActive: input.isActive,
})

/**
 * Data layer for the CategorizationRules dashboard page (Sprint 13.9). Branches on
 * `isLocalFirstEnabled()`: the server branch is the page's pre-existing `useAsyncData` + axios code,
 * relocated verbatim; the local branch reads/writes through the local SQLite store via
 * `Repository`/`useLocalQuery`, and its "bulk apply"/"test" actions are pure local computation via
 * `domain/categorizationRules.ts` - no REST call at all when local-first is on.
 */
export const useCategorizationRulesData = (): UseCategorizationRulesDataResult => {
    const { user } = useUser()
    const localFirst = isLocalFirstEnabled()

    // `useAsyncData` must still be called unconditionally (rules of hooks) even when local-first is
    // on and its result is discarded below - guard the fetcher itself so no real network request
    // goes out in that case (mirrors `useDashboardSummaryData.ts`'s `localFirst` guard).
    const fetchRules = useCallback(async (): Promise<CategorizationRule[]> => {
        if (localFirst) return []
        try {
            const response = await axiosInstance.get<ApiResponse<CategorizationRule[]>>(
                API_PATHS.CATEGORIZATION_RULES.GET_ALL
            )
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load categorization rules'))
        }
    }, [localFirst])

    const serverQuery = useAsyncData(fetchRules, [fetchRules])

    const localFetcher = useCallback(async (db: LocalDb): Promise<CategorizationRule[]> => {
        const rows = await rulesRepo.list(db)
        return rows.map(toRuleView).sort((a, b) => b.priority - a.priority)
    }, [])

    const localQuery = useLocalQuery<CategorizationRule[]>('categorizationRules', localFetcher)

    if (!localFirst) {
        return {
            rules: serverQuery.data,
            loading: serverQuery.loading,
            error: serverQuery.error,
            refetch: serverQuery.refetch,
            createRule: async (input) => {
                await axiosInstance.post(API_PATHS.CATEGORIZATION_RULES.CREATE, buildRestPayload(input))
                await serverQuery.refetch()
            },
            updateRule: async (rule, input) => {
                await axiosInstance.put(API_PATHS.CATEGORIZATION_RULES.UPDATE(rule._id), buildRestPayload(input))
                await serverQuery.refetch()
            },
            deleteRule: async (rule) => {
                await axiosInstance.delete(API_PATHS.CATEGORIZATION_RULES.DELETE(rule._id))
                await serverQuery.refetch()
            },
            toggleRuleActive: async (rule) => {
                await axiosInstance.put(API_PATHS.CATEGORIZATION_RULES.UPDATE(rule._id), {
                    isActive: !rule.isActive,
                })
                await serverQuery.refetch()
            },
            bulkApply: async () => {
                const response = await axiosInstance.post<ApiResponse<CategorizationRuleBulkApplyResult>>(
                    API_PATHS.CATEGORIZATION_RULES.BULK_APPLY
                )
                return unwrapApiData(response)
            },
            testRule: async (input) => {
                const response = await axiosInstance.post<ApiResponse<CategorizationRuleTestResult>>(
                    API_PATHS.CATEGORIZATION_RULES.TEST,
                    input
                )
                return unwrapApiData(response)
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
            const doc = buildLocalDoc(input, {
                _id: generateLocalObjectId(),
                updatedAt: new Date().toISOString(),
                userId: user._id,
            })
            await db.transaction(async (tx) => {
                await rulesRepo.create(tx, doc)
            })
            tableInvalidationBus.publish('categorizationRules')
        },
        updateRule: async (rule, input) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await rulesRepo.findById(tx, rule._id)
                if (!existing) throw new Error('Rule not found locally')
                const updated = buildLocalDoc(input, {
                    _id: existing._id,
                    updatedAt: new Date().toISOString(),
                    userId: existing.userId,
                })
                await rulesRepo.update(tx, updated, existing.updatedAt)
            })
            tableInvalidationBus.publish('categorizationRules')
        },
        deleteRule: async (rule) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                await rulesRepo.remove(tx, rule._id)
            })
            tableInvalidationBus.publish('categorizationRules')
        },
        toggleRuleActive: async (rule) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await rulesRepo.findById(tx, rule._id)
                if (!existing) throw new Error('Rule not found locally')
                await rulesRepo.update(tx, { ...existing, isActive: !existing.isActive }, existing.updatedAt)
            })
            tableInvalidationBus.publish('categorizationRules')
        },
        bulkApply: async () => {
            const db = await getLocalDb()
            const result = await bulkApplyLocalCategorizationRules(db)
            if (result.updated > 0) {
                tableInvalidationBus.publish('transactions')
            }
            return {
                message: `Updated ${result.updated} transaction${result.updated === 1 ? '' : 's'}, skipped ${result.skipped}`,
                updated: result.updated,
                skipped: result.skipped,
            }
        },
        testRule: async (input) => {
            const db = await getLocalDb()
            const matched = await findMatchingLocalRule(db, input)
            if (!matched) {
                return { matched: false, message: 'No active rule matched the sample transaction' }
            }
            return {
                matched: true,
                ruleId: matched._id,
                ruleName: matched.name,
                categoryId: matched.categoryId,
                tags: matched.tags ?? [],
            }
        },
    }
}
