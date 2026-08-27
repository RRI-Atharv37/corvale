import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor, userEvent } from '../../../test/test-utils'
import Reports from '../Reports'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'
import type { User } from '../../../types/api'

// X3 / BUG-05: `fetchServerReports` used to run its 17 requests inside one `Promise.all`, so any
// single failing endpoint discarded every other section's already-successful response and blanked
// the whole page. This suite pins the fixed contract: sections that loaded still render, and only
// the failing section shows a scoped error with its own retry.

vi.mock('../../../utils/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
    },
}))

const mockUser: User = {
    _id: 'user1',
    fullName: 'Jamie Rivera',
    email: 'jamie@example.com',
    preferredCurrency: 'USD',
    timezone: 'UTC',
}

const REPORT_FIXTURES: Record<string, unknown> = {
    [API_PATHS.REPORTS.AVERAGES]: {
        periodType: 'custom',
        periodStart: '2026-01-01',
        periodEnd: '2026-06-30',
        totalIncome: 30000,
        totalExpenses: 18000,
        netSavings: 12000,
        unit: 'month',
        unitCount: 6,
        averageIncome: 5000,
        averageExpenses: 3000,
        averageNetSavings: 2000,
    },
    [API_PATHS.REPORTS.LARGEST_EXPENSES]: {
        periodStart: '2026-01-01',
        periodEnd: '2026-06-30',
        expenses: [
            {
                transactionId: 'tx1',
                title: 'Rent payment',
                categoryName: 'Housing',
                date: '2026-06-01',
                amount: 1200,
                currency: 'USD',
            },
        ],
    },
    [API_PATHS.REPORTS.SPENDING_TRENDS]: {
        periodStart: '2026-01-01',
        periodEnd: '2026-06-30',
        trends: [{ period: '2026-06', expense: 3000, changePercent: 5, trend: 'up' }],
    },
    [API_PATHS.REPORTS.INCOME_VS_EXPENSE]: {
        periodStart: '2026-01-01',
        periodEnd: '2026-06-30',
        totalIncome: 30000,
        totalExpenses: 18000,
        netSavings: 12000,
        expenseToIncomeRatio: 0.6,
        incomeShare: 0.6,
        expenseShare: 0.4,
    },
    [API_PATHS.REPORTS.SAVINGS_RATE]: {
        savingsRate: 40,
        totalIncome: 30000,
        totalExpenses: 18000,
        netSavings: 12000,
        periodStart: '2026-01-01',
        periodEnd: '2026-06-30',
    },
    [API_PATHS.REPORTS.RECURRING_TOTALS]: {
        activeExpenseRules: [],
        totalMonthlyEquivalent: 500,
        postedRecurringExpensesInPeriod: 300,
        periodStart: '2026-01-01',
        periodEnd: '2026-06-30',
    },
    [API_PATHS.DASHBOARD.CATEGORY_BREAKDOWN]: { type: 'expense', breakdown: [] },
    [API_PATHS.REPORTS.BUDGET_ANALYSIS]: {
        periodStart: '2026-01-01',
        periodEnd: '2026-06-30',
        budgets: [],
        totalBudgeted: 0,
        totalSpent: 0,
        overBudgetCount: 0,
        underBudgetCount: 0,
    },
    [API_PATHS.REPORTS.SPENDING_ANALYSIS]: {
        periodStart: '2026-01-01',
        periodEnd: '2026-06-30',
        totalExpenses: 18000,
        transactionCount: 12,
        averagePerTransaction: 150,
        topCategories: [],
        topPaymentMethods: [],
        largestExpenses: [],
        trends: [],
    },
    [API_PATHS.REPORTS.CROSSOVER_POINT]: {
        periodStart: '2026-01-01',
        periodEnd: '2026-06-30',
        hasCrossover: false,
        crossoverPeriod: null,
        monthlyCrossoverPeriod: null,
        cumulativeIncomeAtCrossover: null,
        cumulativeExpenseAtCrossover: null,
        series: [],
    },
    [API_PATHS.REPORTS.SAVED]: [],
    [API_PATHS.DASHBOARD.CASH_FLOW]: {
        groupBy: 'month',
        periodStart: '2026-01-01',
        periodEnd: '2026-06-30',
        series: [],
    },
    [API_PATHS.DASHBOARD.NET_WORTH_TREND]: {
        series: [],
        currentBalances: {},
        balanceSource: 'accounts',
        periodStart: '2026-01-01',
        periodEnd: '2026-06-30',
    },
    [API_PATHS.DASHBOARD.BUDGET_OVERVIEW]: { periodStart: '2026-06-01', periodEnd: '2026-06-30', budgets: [] },
    [API_PATHS.RECURRING_RULES.GET_ALL]: [],
    [API_PATHS.RECURRING_RULES.GET_DRAFTS]: [],
    [API_PATHS.WORKSPACES.GET_ALL]: [],
}

/** Every reports GET succeeds unless `url` matches `failingUrl`, which rejects with `failingMessage`
 * as long as `shouldFail()` returns true - lets a test flip a failing endpoint back to healthy
 * mid-test to exercise retry without re-mocking. */
const mockReportsGet = (failingUrl?: string, failingMessage?: string, shouldFail: () => boolean = () => true) => {
    vi.mocked(axiosInstance.get).mockImplementation(async (url: string) => {
        if (failingUrl && url === failingUrl && shouldFail()) {
            throw new Error(failingMessage ?? 'Request failed')
        }
        const fixture = REPORT_FIXTURES[url]
        if (fixture === undefined) {
            throw new Error(`Unhandled GET ${url} in test`)
        }
        return { success: true, data: fixture }
    })
}

beforeEach(() => {
    vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
        if (url === API_PATHS.AUTH.REFRESH) {
            return { success: true, data: { token: 'test-token', user: mockUser } }
        }
        return { success: true, data: [] }
    })
    mockReportsGet()
})

describe('Reports page resilience (X3, BUG-05)', () => {
    it('renders every section when all reports endpoints succeed', async () => {
        renderWithProviders(<Reports />, { route: '/reports' })

        await waitFor(() => expect(screen.getByText('40.0%')).toBeInTheDocument())

        expect(screen.getByText(/Rent payment/)).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: 'Crossover point' })).toBeInTheDocument()
        expect(screen.queryByText(/try again/i)).not.toBeInTheDocument()
    })

    it('keeps other sections rendering and scopes the error when one endpoint fails', async () => {
        mockReportsGet(API_PATHS.REPORTS.CROSSOVER_POINT, 'Crossover point endpoint is down')

        renderWithProviders(<Reports />, { route: '/reports' })

        // Sections fed by other endpoints still render with real data.
        await waitFor(() => expect(screen.getByText('40.0%')).toBeInTheDocument())
        expect(screen.getByText(/Rent payment/)).toBeInTheDocument()

        // Only the failing section shows a scoped error, not the whole page.
        const crossoverHeading = screen.getByRole('heading', { name: 'Crossover point' })
        const crossoverCard = crossoverHeading.closest('.card')
        if (!crossoverCard) throw new Error('Crossover point card not found')
        expect(crossoverCard).toHaveTextContent('Crossover point endpoint is down')

        const retryButtons = screen.getAllByRole('button', { name: /try again/i })
        expect(retryButtons).toHaveLength(1)
    })

    it('recovers a failed section on retry without re-erroring the rest of the page', async () => {
        let crossoverShouldFail = true
        mockReportsGet(API_PATHS.REPORTS.CROSSOVER_POINT, 'Crossover point endpoint is down', () => crossoverShouldFail)

        renderWithProviders(<Reports />, { route: '/reports' })

        await waitFor(() => expect(screen.getByText('Crossover point endpoint is down')).toBeInTheDocument())
        expect(screen.getByText('40.0%')).toBeInTheDocument()

        crossoverShouldFail = false
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: /try again/i }))

        await waitFor(() =>
            expect(screen.queryByText('Crossover point endpoint is down')).not.toBeInTheDocument()
        )
        expect(
            screen.getByText('Income has not yet exceeded cumulative expenses in this period')
        ).toBeInTheDocument()
        expect(screen.getByText('40.0%')).toBeInTheDocument()
    })
})
