import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { useDashboardSummaryData } from '@features/dashboard/hooks/useDashboardSummaryData'
import { useReportsData } from '../useReportsData'

/**
 * S55 follow-up: the online dashboard and reports requests sent no workspace, so with a workspace
 * active the web showed personal numbers while local-first (BUG-73) showed the workspace's. Every
 * scope-aware dashboard/reports/recurring request now carries the active workspace, and a workspace
 * switch refetches.
 */

const workspaceState = vi.hoisted(() => ({ activeWorkspaceId: null as string | null }))

vi.mock('@/app/providers/useWorkspace', () => ({
    useWorkspace: () => ({ activeWorkspaceId: workspaceState.activeWorkspaceId }),
}))

vi.mock('@/app/providers/useUser', () => ({
    useUser: () => ({ user: { _id: 'user1', timezone: 'UTC', preferredCurrency: 'USD', exchangeRates: {} } }),
}))

vi.mock('@lib/axiosInstance', () => ({
    default: { get: vi.fn(), post: vi.fn() },
}))

const periodParams = { periodType: 'monthly' as const, year: 2026, month: 1 }
const periodDates = { startDate: '2026-01-01', endDate: '2026-01-31' }
const chartQuery = { ...periodDates, groupBy: 'month' as const }

beforeEach(() => {
    workspaceState.activeWorkspaceId = null
    vi.mocked(axiosInstance.get).mockResolvedValue({ data: { success: true, data: {} } })
})

afterEach(() => {
    vi.clearAllMocks()
})

const paramsSentTo = (path: string): Record<string, unknown>[] =>
    vi
        .mocked(axiosInstance.get)
        .mock.calls.filter((call) => call[0] === path)
        .map((call) => (call[1] as { params?: Record<string, unknown> } | undefined)?.params ?? {})

describe('online dashboard and reports requests carry the active workspace', () => {
    it('dashboard summary', async () => {
        workspaceState.activeWorkspaceId = 'ws-1'
        renderHook(() => useDashboardSummaryData(periodDates))

        await waitFor(() => expect(paramsSentTo(API_PATHS.DASHBOARD.SUMMARY)).toHaveLength(1))
        expect(paramsSentTo(API_PATHS.DASHBOARD.SUMMARY)[0]).toMatchObject({ ...periodDates, workspaceId: 'ws-1' })
    })

    it('every scope-aware report section, including budget overview, recurring rules and drafts', async () => {
        workspaceState.activeWorkspaceId = 'ws-1'
        renderHook(() => useReportsData(periodParams, periodDates, chartQuery, chartQuery, 0))

        await waitFor(() => expect(paramsSentTo(API_PATHS.RECURRING_RULES.GET_DRAFTS)).toHaveLength(1))

        const scoped = [
            API_PATHS.REPORTS.AVERAGES,
            API_PATHS.REPORTS.LARGEST_EXPENSES,
            API_PATHS.REPORTS.SPENDING_TRENDS,
            API_PATHS.REPORTS.INCOME_VS_EXPENSE,
            API_PATHS.REPORTS.SAVINGS_RATE,
            API_PATHS.REPORTS.RECURRING_TOTALS,
            API_PATHS.REPORTS.BUDGET_ANALYSIS,
            API_PATHS.REPORTS.SPENDING_ANALYSIS,
            API_PATHS.REPORTS.CROSSOVER_POINT,
            API_PATHS.DASHBOARD.CATEGORY_BREAKDOWN,
            API_PATHS.DASHBOARD.CASH_FLOW,
            API_PATHS.DASHBOARD.NET_WORTH_TREND,
            API_PATHS.DASHBOARD.BUDGET_OVERVIEW,
            API_PATHS.RECURRING_RULES.GET_ALL,
            API_PATHS.RECURRING_RULES.GET_DRAFTS,
        ]
        for (const path of scoped) {
            const sent = paramsSentTo(path)
            expect(sent.length, path).toBeGreaterThan(0)
            for (const params of sent) {
                expect(params, path).toMatchObject({ workspaceId: 'ws-1' })
            }
        }
    })

    it('sends no workspaceId in personal scope', async () => {
        renderHook(() => useReportsData(periodParams, periodDates, chartQuery, chartQuery, 0))

        await waitFor(() => expect(paramsSentTo(API_PATHS.DASHBOARD.BUDGET_OVERVIEW)).toHaveLength(1))
        for (const call of vi.mocked(axiosInstance.get).mock.calls) {
            const params = (call[1] as { params?: Record<string, unknown> } | undefined)?.params ?? {}
            expect(params).not.toHaveProperty('workspaceId')
        }
    })

    it('refetches the report sections when the workspace switches', async () => {
        const { rerender } = renderHook(() => useReportsData(periodParams, periodDates, chartQuery, chartQuery, 0))
        await waitFor(() => expect(paramsSentTo(API_PATHS.REPORTS.AVERAGES)).toHaveLength(1))

        workspaceState.activeWorkspaceId = 'ws-1'
        rerender()

        await waitFor(() =>
            expect(paramsSentTo(API_PATHS.REPORTS.AVERAGES).at(-1)).toMatchObject({ workspaceId: 'ws-1' })
        )
    })
})
