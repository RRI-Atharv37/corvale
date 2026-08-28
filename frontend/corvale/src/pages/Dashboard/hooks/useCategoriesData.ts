import { useCallback } from 'react'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'
import { useAsyncData } from '../../../hooks/useAsyncData'
import { useLocalQuery } from '../../../db/useLocalQuery'
import { getLocalDb } from '../../../db/localDbInstance'
import { tableInvalidationBus } from '../../../db/invalidation/tableInvalidationBus'
import { Repository } from '../../../db/repositories/Repository'
import { generateLocalObjectId } from '../../../db/generateLocalId'
import { isLocalFirstEnabled } from '../../../utils/localFirstFlag'
import { syncNow } from '../../../sync/syncEngine'
import { unwrapApiData } from '../../../utils/apiHelpers'
import { getApiErrorMessage } from '../../../utils/apiError'
import { useUser } from '../../../hooks/useUser'
import type { ApiResponse, CategoriesResponse, Category } from '../../../types/api'
import type { LocalCategory } from '../../../domain/types'
import type { LocalDb } from '../../../db/LocalDb'

/** `LocalCategory` (domain/types.ts) has no `icon`/`isDefault`/`sortOrder` fields yet - they
 * round-trip fine through the JSON `data` blob (Repository stores the full doc), this just widens
 * the local type so this hook can read/write them without touching shared infra. */
interface LocalCategoryRecord extends LocalCategory {
    icon?: string
    isDefault: boolean
    sortOrder: number
}

const categoriesRepo = new Repository<LocalCategoryRecord>('categories')

export interface CreateCategoryInput {
    masterCategoryId: string
    name: string
    icon: string
    color: string
}

export interface UpdateCategoryInput {
    name: string
    icon: string
    color: string
}

export interface UseCategoriesDataResult {
    categories: CategoriesResponse | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
    createCategory: (input: CreateCategoryInput) => Promise<void>
    updateCategory: (category: Category, input: UpdateCategoryInput) => Promise<void>
    archiveCategory: (category: Category) => Promise<void>
    setDefaultCategory: (category: Category) => Promise<void>
    /** `PUT /categories/reorder` has no local equivalent - stays a plain REST call even when
     * `VITE_LOCAL_FIRST` is on, followed by a sync + refetch so the local mirror picks up the new
     * `sortOrder`. Callers must gate this on `useOnlineStatus()` themselves (see Categories.tsx). */
    reorderCategories: (orderedIds: string[]) => Promise<void>
}

const toCategoryView = (category: LocalCategoryRecord): Category => ({
    _id: category._id,
    userId: category.userId,
    masterCategoryId: category.masterCategoryId,
    name: category.name,
    icon: category.icon,
    color: category.color,
    isDefault: category.isDefault ?? false,
    isArchived: category.isArchived,
    sortOrder: category.sortOrder ?? 0,
    updatedAt: category.updatedAt,
})

const findCurrentDefault = (categories: LocalCategoryRecord[], excludeId?: string): LocalCategoryRecord | undefined =>
    categories.find((category) => category.isDefault && !category.isArchived && category._id !== excludeId)

/**
 * Data layer for the Categories dashboard page (Sprint 13.9). Branches on `isLocalFirstEnabled()`:
 * the server branch is the page's pre-existing `useAsyncData` + axios code, relocated verbatim;
 * the local branch reads/writes through the local SQLite store via `Repository`/`useLocalQuery`.
 */
export const useCategoriesData = (): UseCategoriesDataResult => {
    const { user } = useUser()
    const localFirst = isLocalFirstEnabled()

    const fetchCategories = useCallback(async (): Promise<CategoriesResponse> => {
        // Both branches' hooks are always called (rules of hooks), but when local-first is on the
        // server branch's result is never read - skip the network round-trip rather than firing it
        // uselessly on every mount.
        if (localFirst) return { masters: [], userCategories: [] }
        try {
            const response = await axiosInstance.get<ApiResponse<CategoriesResponse>>(API_PATHS.CATEGORIES.GET_ALL)
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load categories'))
        }
    }, [localFirst])

    const serverQuery = useAsyncData(fetchCategories, [fetchCategories])

    const localFetcher = useCallback(async (db: LocalDb): Promise<CategoriesResponse> => {
        const rows = await categoriesRepo.list(db)
        const active = rows.filter((category) => !category.isArchived)
        return {
            masters: active.filter((category) => category.masterCategoryId === null).map(toCategoryView),
            userCategories: active.filter((category) => category.masterCategoryId !== null).map(toCategoryView),
        }
    }, [])

    const localQuery = useLocalQuery<CategoriesResponse>(['categories', '_prefs'], localFetcher)

    if (!localFirst) {
        return {
            categories: serverQuery.data,
            loading: serverQuery.loading,
            error: serverQuery.error,
            refetch: serverQuery.refetch,
            createCategory: async (input) => {
                await axiosInstance.post(API_PATHS.CATEGORIES.CREATE, {
                    masterCategoryId: input.masterCategoryId,
                    name: input.name,
                    icon: input.icon,
                    color: input.color,
                })
                await serverQuery.refetch()
            },
            updateCategory: async (category, input) => {
                await axiosInstance.put(API_PATHS.CATEGORIES.UPDATE(category._id), {
                    name: input.name,
                    icon: input.icon,
                    color: input.color,
                })
                await serverQuery.refetch()
            },
            archiveCategory: async (category) => {
                await axiosInstance.delete(API_PATHS.CATEGORIES.DELETE(category._id))
                await serverQuery.refetch()
            },
            setDefaultCategory: async (category) => {
                if (category.isDefault) return
                await axiosInstance.put(API_PATHS.CATEGORIES.UPDATE(category._id), { isDefault: true })
                await serverQuery.refetch()
            },
            reorderCategories: async (orderedIds) => {
                await axiosInstance.put(API_PATHS.CATEGORIES.REORDER, { orderedIds })
                await serverQuery.refetch()
            },
        }
    }

    return {
        categories: localQuery.data,
        loading: localQuery.loading,
        error: localQuery.error,
        refetch: localQuery.refetch,
        createCategory: async (input) => {
            if (!user) throw new Error('Not authenticated')
            const db = await getLocalDb()
            const nowIso = new Date().toISOString()
            const _id = generateLocalObjectId()
            await db.transaction(async (tx) => {
                const existing = await categoriesRepo.list(tx)
                const siblings = existing.filter(
                    (category) => category.masterCategoryId === input.masterCategoryId
                )
                const maxSortOrder = siblings.reduce((max, category) => Math.max(max, category.sortOrder ?? -1), -1)

                const doc: LocalCategoryRecord = {
                    _id,
                    updatedAt: nowIso,
                    userId: user._id,
                    masterCategoryId: input.masterCategoryId,
                    name: input.name,
                    icon: input.icon,
                    color: input.color,
                    isDefault: false,
                    isArchived: false,
                    sortOrder: maxSortOrder + 1,
                }
                await categoriesRepo.create(tx, doc)
            })
            tableInvalidationBus.publish('categories')
        },
        updateCategory: async (category, input) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await categoriesRepo.findById(tx, category._id)
                if (!existing) throw new Error('Category not found')
                await categoriesRepo.update(
                    tx,
                    { ...existing, name: input.name, icon: input.icon, color: input.color },
                    existing.updatedAt
                )
            })
            tableInvalidationBus.publish('categories')
        },
        archiveCategory: async (category) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await categoriesRepo.findById(tx, category._id)
                if (!existing) throw new Error('Category not found')
                await categoriesRepo.update(tx, { ...existing, isArchived: true, isDefault: false }, existing.updatedAt)
            })
            tableInvalidationBus.publish('categories')
        },
        setDefaultCategory: async (category) => {
            if (category.isDefault) return
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await categoriesRepo.list(tx)
                const currentDefault = findCurrentDefault(existing, category._id)
                if (currentDefault) {
                    await categoriesRepo.update(tx, { ...currentDefault, isDefault: false }, currentDefault.updatedAt)
                }
                const target = await categoriesRepo.findById(tx, category._id)
                if (!target) throw new Error('Category not found')
                await categoriesRepo.update(tx, { ...target, isDefault: true }, target.updatedAt)
            })
            tableInvalidationBus.publish('categories')
        },
        reorderCategories: async (orderedIds) => {
            await axiosInstance.put(API_PATHS.CATEGORIES.REORDER, { orderedIds })
            await syncNow()
            await localQuery.refetch()
        },
    }
}
