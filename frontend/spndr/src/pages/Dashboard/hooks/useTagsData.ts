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
import type { ApiResponse, Tag } from '../../../types/api'
import type { LocalTag } from '../../../domain/types'
import type { LocalDb } from '../../../db/LocalDb'

const tagsRepo = new Repository<LocalTag>('tags')

export interface TagInput {
    name: string
    color: string
}

export interface DedupeResult {
    created: number
    skipped: number
    message: string
}

export interface UseTagsDataResult {
    tags: Tag[] | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
    createTag: (input: TagInput) => Promise<void>
    updateTag: (tag: Tag, input: TagInput) => Promise<void>
    /** Tags have a real server-side soft delete (`deletedAt`) matching the local tombstone column
     * exactly, so - unlike accounts/categories - this goes through `repo.remove()`. */
    deleteTag: (tag: Tag) => Promise<void>
    /** `POST /tags/dedupe` has no local equivalent - stays a plain REST call even when
     * `VITE_LOCAL_FIRST` is on, followed by a sync + refetch so the local mirror picks up any newly
     * created tags. Callers must gate this on `useOnlineStatus()` themselves (see Tags.tsx). */
    dedupeTags: () => Promise<DedupeResult>
}

const toTagView = (tag: LocalTag): Tag => ({
    _id: tag._id,
    userId: tag.userId,
    name: tag.name,
    color: tag.color,
    updatedAt: tag.updatedAt,
})

/**
 * Data layer for the Tags dashboard page (Sprint 13.9). Branches on `isLocalFirstEnabled()`: the
 * server branch is the page's pre-existing `useAsyncData` + axios code, relocated verbatim; the
 * local branch reads/writes through the local SQLite store via `Repository`/`useLocalQuery`.
 */
export const useTagsData = (): UseTagsDataResult => {
    const { user } = useUser()
    const localFirst = isLocalFirstEnabled()

    const fetchTags = useCallback(async (): Promise<Tag[]> => {
        // Both branches' hooks are always called (rules of hooks), but when local-first is on the
        // server branch's result is never read - skip the network round-trip rather than firing it
        // uselessly on every mount.
        if (localFirst) return []
        try {
            const response = await axiosInstance.get<ApiResponse<Tag[]>>(API_PATHS.TAGS.GET_ALL)
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load tags'))
        }
    }, [localFirst])

    const serverQuery = useAsyncData(fetchTags, [fetchTags])

    const localFetcher = useCallback(async (db: LocalDb): Promise<Tag[]> => {
        const rows = await tagsRepo.list(db)
        return rows.map(toTagView)
    }, [])

    const localQuery = useLocalQuery<Tag[]>('tags', localFetcher)

    if (!localFirst) {
        return {
            tags: serverQuery.data,
            loading: serverQuery.loading,
            error: serverQuery.error,
            refetch: serverQuery.refetch,
            createTag: async (input) => {
                await axiosInstance.post(API_PATHS.TAGS.CREATE, { name: input.name, color: input.color })
                await serverQuery.refetch()
            },
            updateTag: async (tag, input) => {
                await axiosInstance.put(API_PATHS.TAGS.UPDATE(tag._id), { name: input.name, color: input.color })
                await serverQuery.refetch()
            },
            deleteTag: async (tag) => {
                await axiosInstance.delete(API_PATHS.TAGS.DELETE(tag._id))
                await serverQuery.refetch()
            },
            dedupeTags: async () => {
                const response = await axiosInstance.post<ApiResponse<DedupeResult>>(API_PATHS.TAGS.DEDUPE)
                const result = unwrapApiData(response)
                await serverQuery.refetch()
                return result
            },
        }
    }

    return {
        tags: localQuery.data,
        loading: localQuery.loading,
        error: localQuery.error,
        refetch: localQuery.refetch,
        createTag: async (input) => {
            if (!user) throw new Error('Not authenticated')
            const db = await getLocalDb()
            const doc: LocalTag = {
                _id: generateLocalObjectId(),
                updatedAt: new Date().toISOString(),
                userId: user._id,
                name: input.name,
                color: input.color,
            }
            await db.transaction(async (tx) => {
                await tagsRepo.create(tx, doc)
            })
            tableInvalidationBus.publish('tags')
        },
        updateTag: async (tag, input) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await tagsRepo.findById(tx, tag._id)
                if (!existing) throw new Error('Tag not found')
                await tagsRepo.update(tx, { ...existing, name: input.name, color: input.color }, existing.updatedAt)
            })
            tableInvalidationBus.publish('tags')
        },
        deleteTag: async (tag) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                await tagsRepo.remove(tx, tag._id)
            })
            tableInvalidationBus.publish('tags')
        },
        dedupeTags: async () => {
            const response = await axiosInstance.post<ApiResponse<DedupeResult>>(API_PATHS.TAGS.DEDUPE)
            const result = unwrapApiData(response)
            await syncNow()
            await localQuery.refetch()
            return result
        },
    }
}
