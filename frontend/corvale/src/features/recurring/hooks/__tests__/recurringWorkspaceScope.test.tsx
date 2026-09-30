import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { getLocalDb, resetLocalDbForTests } from '@platform/db/localDbInstance'
import { Repository } from '@platform/db/repositories/Repository'
import type { LocalRecurringRule } from '@domain/types'
import { useRecurringData } from '../useRecurringData'
import { useRecurringDrafts } from '../useRecurringDrafts'

/**
 * BUG-73 / BUG-74 (S55): on local-first the rules list showed every scope in the local store, and the
 * draft hook called generate-drafts / drafts with no workspace parameter, so a workspace rule never
 * got drafts through the Recurring page (both endpoints then scope to personal).
 */

const workspaceState = vi.hoisted(() => ({ activeWorkspaceId: null as string | null }))

vi.mock('@/app/providers/useWorkspace', () => ({
    useWorkspace: () => ({ activeWorkspaceId: workspaceState.activeWorkspaceId }),
}))

vi.mock('@/app/providers/useUser', () => ({
    useUser: () => ({ user: { _id: 'user1', timezone: 'UTC' } }),
}))

vi.mock('@platform/sync/syncEngine', () => ({ syncNow: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@lib/axiosInstance', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const recurringRepo = new Repository<LocalRecurringRule>('recurringRules')

const buildRule = (overrides: Partial<LocalRecurringRule>): LocalRecurringRule => ({
    _id: 'rule',
    updatedAt: new Date().toISOString(),
    userId: 'user1',
    workspaceId: null,
    title: 'Rule',
    type: 'expense',
    amount: 1500,
    currency: 'USD',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    interval: 'monthly',
    nextDueDate: '2026-09-01',
    tags: [],
    isActive: true,
    isArchived: false,
    isCancelled: false,
    ...overrides,
})

beforeEach(() => {
    workspaceState.activeWorkspaceId = null
    vi.mocked(axiosInstance.get).mockResolvedValue({ data: { success: true, data: [] } })
    vi.mocked(axiosInstance.post).mockResolvedValue({ data: { success: true, data: [] } })
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
})

describe('useRecurringDrafts sends the active workspace (BUG-74)', () => {
    it('passes workspaceId on generate-drafts and on the drafts list when a workspace is active', async () => {
        workspaceState.activeWorkspaceId = 'ws-1'
        const { result } = renderHook(() => useRecurringDrafts())

        await act(async () => {
            await result.current.generateAndRefreshDrafts()
        })

        const post = vi.mocked(axiosInstance.post).mock.calls[0]
        expect(post[0]).toBe(API_PATHS.RECURRING_RULES.GENERATE_DRAFTS)
        expect(post[2]).toEqual({ params: { workspaceId: 'ws-1' } })

        const get = vi.mocked(axiosInstance.get).mock.calls.at(-1)
        expect(get?.[0]).toBe(API_PATHS.RECURRING_RULES.GET_DRAFTS)
        expect(get?.[1]).toEqual({ params: { workspaceId: 'ws-1' } })
    })

    it('sends no workspaceId in personal scope', async () => {
        const { result } = renderHook(() => useRecurringDrafts())

        await act(async () => {
            await result.current.generateAndRefreshDrafts()
        })

        expect(vi.mocked(axiosInstance.post).mock.calls[0][2]).toEqual({ params: {} })
        expect(vi.mocked(axiosInstance.get).mock.calls.at(-1)?.[1]).toEqual({ params: {} })
    })

    it('lists the active workspace drafts after generating for a single rule', async () => {
        workspaceState.activeWorkspaceId = 'ws-1'
        const { result } = renderHook(() => useRecurringDrafts())

        await act(async () => {
            await result.current.generateDraftsForRule('rule-w')
        })

        expect(vi.mocked(axiosInstance.get).mock.calls.at(-1)?.[1]).toEqual({ params: { workspaceId: 'ws-1' } })
    })
})

describe('useRecurringData (local-first) shows only the active scope (BUG-73)', () => {
    it('filters the rules list by workspace and refetches when the workspace switches', async () => {
        vi.stubEnv('VITE_LOCAL_FIRST', 'true')
        resetLocalDbForTests()
        const db = await getLocalDb()
        await recurringRepo.upsertFromServer(db, [
            buildRule({ _id: 'rule-p', title: 'Personal rule', workspaceId: null }),
            buildRule({ _id: 'rule-w', title: 'Shared rule', workspaceId: 'ws-1' }),
        ])

        const { result, rerender } = renderHook(() => useRecurringData())
        await waitFor(() => expect(result.current.rules?.map((rule) => rule.title)).toEqual(['Personal rule']))

        workspaceState.activeWorkspaceId = 'ws-1'
        rerender()
        await waitFor(() => expect(result.current.rules?.map((rule) => rule.title)).toEqual(['Shared rule']))
    })
})
