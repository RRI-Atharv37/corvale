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
import { useUser } from '@/app/providers/useUser'
import type { ApiResponse, TransactionTemplate, TransactionTemplateType } from '@lib/types/api'
import type { LocalTransactionTemplate } from '@domain/types'
import type { LocalDb } from '@platform/db/LocalDb'

const templatesRepo = new Repository<LocalTransactionTemplate>('transactionTemplates')

/** Form-shaped input for both create and update. `amount` is major units (what the form's number
 * input holds); conversion to the local store's minor-unit convention happens here. */
export interface TransactionTemplateInput {
    name: string
    type: TransactionTemplateType
    amount: number
    accountId: string
    categoryId: string
    tags: string[]
    description?: string
}

export interface UseTransactionTemplatesDataResult {
    templates: TransactionTemplate[] | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
    createTemplate: (input: TransactionTemplateInput) => Promise<void>
    updateTemplate: (template: TransactionTemplate, input: TransactionTemplateInput) => Promise<void>
    deleteTemplate: (template: TransactionTemplate) => Promise<void>
}

/**
 * `LocalTransactionTemplate.amount` mirrors the raw DB value shipped by
 * `/sync/bootstrap`/`/sync/pull` (no serialization), so it is minor units like
 * `LocalTransaction.amount` - not the major-unit value the REST `GET /transaction-templates`
 * response carries after `serializeTransactionTemplate`'s `fromMinorUnits` step. See
 * `db/repositories/__tests__/transactionTemplates.test.ts` for the local table's raw shape.
 */
const toTemplateView = (template: LocalTransactionTemplate): TransactionTemplate => ({
    _id: template._id,
    userId: template.userId,
    name: template.name,
    type: template.type,
    amount: fromMinorUnits(template.amount),
    accountId: template.accountId,
    categoryId: template.categoryId,
    tags: template.tags ?? [],
    description: template.description,
    updatedAt: template.updatedAt,
})

/**
 * Data layer for `TransactionTemplatesSettings` (Sprint 13.9). Branches on `isLocalFirstEnabled()`:
 * the server branch is the component's pre-existing `useAsyncData` + axios code, relocated verbatim;
 * the local branch reads/writes through the local SQLite store via `Repository`/`useLocalQuery`.
 * `TransactionTemplate` has a real server-side soft delete (`deletedAt`, like `Tag`), so delete is a
 * plain `repo.remove()` - no archive-flag translation needed, unlike `RecurringRule`.
 */
export const useTransactionTemplatesData = (): UseTransactionTemplatesDataResult => {
    const { user } = useUser()
    const localFirst = isLocalFirstEnabled()

    // `useAsyncData` must still be called unconditionally (rules of hooks) even when local-first is
    // on and its result is discarded below - guard the fetcher itself so no real network request
    // goes out in that case (mirrors `useDashboardSummaryData.ts`'s `localFirst` guard).
    const fetchTemplates = useCallback(async (): Promise<TransactionTemplate[]> => {
        if (localFirst) return []
        const response = await axiosInstance.get<ApiResponse<TransactionTemplate[]>>(
            API_PATHS.TRANSACTION_TEMPLATES.GET_ALL
        )
        return unwrapApiData(response)
    }, [localFirst])

    const serverQuery = useAsyncData(fetchTemplates, [fetchTemplates])

    const localFetcher = useCallback(async (db: LocalDb): Promise<TransactionTemplate[]> => {
        const rows = await templatesRepo.list(db)
        return rows.map(toTemplateView)
    }, [])

    const localQuery = useLocalQuery<TransactionTemplate[]>('transactionTemplates', localFetcher)

    if (!localFirst) {
        return {
            templates: serverQuery.data,
            loading: serverQuery.loading,
            error: serverQuery.error,
            refetch: serverQuery.refetch,
            createTemplate: async (input) => {
                await axiosInstance.post(API_PATHS.TRANSACTION_TEMPLATES.CREATE, {
                    name: input.name,
                    type: input.type,
                    amount: input.amount,
                    accountId: input.accountId,
                    categoryId: input.categoryId,
                    tags: input.tags,
                    description: input.description,
                })
                await serverQuery.refetch()
            },
            updateTemplate: async (template, input) => {
                await axiosInstance.put(API_PATHS.TRANSACTION_TEMPLATES.UPDATE(template._id), {
                    name: input.name,
                    type: input.type,
                    amount: input.amount,
                    accountId: input.accountId,
                    categoryId: input.categoryId,
                    tags: input.tags,
                    description: input.description,
                })
                await serverQuery.refetch()
            },
            deleteTemplate: async (template) => {
                await axiosInstance.delete(API_PATHS.TRANSACTION_TEMPLATES.DELETE(template._id))
                await serverQuery.refetch()
            },
        }
    }

    return {
        templates: localQuery.data,
        loading: localQuery.loading,
        error: localQuery.error,
        refetch: localQuery.refetch,
        createTemplate: async (input) => {
            if (!user) throw new Error('Not authenticated')
            const db = await getLocalDb()
            const doc: LocalTransactionTemplate = {
                _id: generateLocalObjectId(),
                updatedAt: new Date().toISOString(),
                userId: user._id,
                name: input.name,
                type: input.type,
                amount: toMinorUnits(input.amount),
                accountId: input.accountId,
                categoryId: input.categoryId,
                tags: input.tags,
                description: input.description,
            }
            await db.transaction(async (tx) => {
                await templatesRepo.create(tx, doc)
            })
            tableInvalidationBus.publish('transactionTemplates')
        },
        updateTemplate: async (template, input) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await templatesRepo.findById(tx, template._id)
                if (!existing) throw new Error('Template not found locally')
                const updated: LocalTransactionTemplate = {
                    ...existing,
                    name: input.name,
                    type: input.type,
                    amount: toMinorUnits(input.amount),
                    accountId: input.accountId,
                    categoryId: input.categoryId,
                    tags: input.tags,
                    description: input.description,
                }
                await templatesRepo.update(tx, updated, existing.updatedAt)
            })
            tableInvalidationBus.publish('transactionTemplates')
        },
        deleteTemplate: async (template) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                await templatesRepo.remove(tx, template._id)
            })
            tableInvalidationBus.publish('transactionTemplates')
        },
    }
}

/** Exposed so `QuickAddDropdown.tsx` (a sibling consumer under `components/transactions/`) can read
 * the same local-aware template list without duplicating the branch/mapping logic. */
export { toTemplateView }
