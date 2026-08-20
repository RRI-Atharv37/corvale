import { useCallback } from 'react'
import { fromMinorUnits } from '@shared/money'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'
import { useAsyncData } from '../../../hooks/useAsyncData'
import { useLocalQuery } from '../../../db/useLocalQuery'
import { isLocalFirstEnabled } from '../../../utils/localFirstFlag'
import { Repository } from '../../../db/repositories/Repository'
import { useUser } from '../../../hooks/useUser'
import { unwrapApiData } from '../../../utils/apiHelpers'
import { getApiErrorMessage } from '../../../utils/apiError'
import {
    computeLocalBudgetOverview,
    computeLocalCashFlowSeries,
    computeLocalCategoryBreakdown,
} from '../../../domain/dashboard'
import {
    computeLocalBudgetAnalysis,
    computeLocalCrossoverPoint,
    computeLocalIncomeVsExpense,
    computeLocalLargestExpenses,
    computeLocalNetWorthOverview,
    computeLocalPeriodAverages,
    computeLocalRecurringTotals,
    computeLocalSavingsRate,
    computeLocalSpendingAnalysis,
    computeLocalSpendingTrends,
    resolveLocalReportPeriod,
    type ReportPeriodQuery,
} from '../../../domain/reports'
import type { LocalDb } from '../../../db/LocalDb'
import type { LocalRecurringRule, LocalTransaction } from '../../../domain/types'
import type {
    ApiResponse,
    BudgetAnalysisReport,
    BudgetOverviewResponse,
    CategoryBreakdownItem,
    ClearedStatus,
    CrossoverPointReport,
    DashboardCashFlowResponse,
    DashboardGroupBy,
    IncomeVsExpenseResponse,
    LargestExpensesResponse,
    NetWorthTrendResponse,
    PeriodAverages,
    RecurringRule,
    RecurringTotalsReport,
    SavedReport,
    SavingsRateReport,
    SpendingAnalysisReport,
    SpendingTrendsResponse,
    Transaction,
} from '../../../types/api'

export interface ReportsData {
    averages: PeriodAverages
    largestExpenses: LargestExpensesResponse
    spendingTrends: SpendingTrendsResponse
    incomeVsExpense: IncomeVsExpenseResponse
    savingsRate: SavingsRateReport
    recurringTotals: RecurringTotalsReport
    categoryBreakdown: CategoryBreakdownItem[]
    budgetAnalysis: BudgetAnalysisReport
    spendingAnalysis: SpendingAnalysisReport
    crossoverPoint: CrossoverPointReport
    savedReports: SavedReport[]
    cashFlow: DashboardCashFlowResponse
    netWorthTrend: NetWorthTrendResponse
    budgetOverview: BudgetOverviewResponse
    thisMonthCashFlow: DashboardCashFlowResponse
    recurringRules: RecurringRule[]
    recurringDrafts: Transaction[]
}

interface PeriodDates {
    startDate: string
    endDate: string
}

interface ChartQuery {
    startDate: string
    endDate: string
    groupBy: DashboardGroupBy
}

interface UseReportsDataResult {
    data: ReportsData | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
}

const recurringRulesRepo = new Repository<LocalRecurringRule>('recurringRules')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

/** `LocalTransaction` (domain/types.ts) has no `currency`/`recurringPaymentId` fields yet - both
 * round-trip fine through the JSON `data` blob (Repository stores the full server doc). Mirrors the
 * identical widening in `useTransactionsData.ts`'s `LocalTransactionRecord`. */
interface LocalTransactionExt extends LocalTransaction {
    currency?: string
    recurringPaymentId?: string | null
}

/** Mirrors `useRecurringData.ts`'s `toRuleView`: `LocalRecurringRule.amount` is minor units (raw
 * sync payload), the view type the rest of the app renders expects major units. */
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

const toDraftView = (tx: LocalTransactionExt): Transaction => ({
    _id: tx._id,
    userId: tx.userId,
    workspaceId: tx.workspaceId ?? null,
    accountId: tx.accountId,
    categoryId: tx.categoryId,
    type: tx.type,
    status: tx.status,
    amount: fromMinorUnits(tx.amount),
    currency: tx.currency ?? 'USD',
    title: tx.title,
    description: tx.description,
    date: tx.date,
    source: tx.source,
    paymentMethod: tx.paymentMethod,
    tags: tx.tags,
    transferPairId: tx.transferPairId ?? null,
    splitTransactionId: tx.splitTransactionId ?? null,
    recurringPaymentId: tx.recurringPaymentId ?? null,
    clearedStatus: (tx.clearedStatus ?? 'pending') as ClearedStatus,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
})

/** Draft generation/confirm/dismiss stay REST-only unconditionally (see `useRecurringDrafts.ts`),
 * but the draft `Transaction` rows themselves ARE a syncable local table, so listing them for the
 * calendar card is a trivial local read - mirrors the server's `getRecurringDrafts` filter
 * (`recurringPaymentId != null`, non-split, sorted by date then createdAt). */
const listLocalRecurringDrafts = async (db: LocalDb): Promise<Transaction[]> => {
    const transactions = (await transactionsRepo.list(db)) as LocalTransactionExt[]
    return transactions
        .filter((tx) => tx.status === 'draft' && tx.splitTransactionId === null && Boolean(tx.recurringPaymentId))
        .sort((a, b) => {
            if (a.date !== b.date) return a.date < b.date ? -1 : 1
            return (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
        })
        .map(toDraftView)
}

const listLocalRecurringRules = async (db: LocalDb): Promise<RecurringRule[]> => {
    const rules = await recurringRulesRepo.list(db)
    return rules.filter((rule) => !rule.isArchived).map(toRuleView)
}

/** Saved report configs (`SavedReport`) have no local equivalent - they stay REST-only regardless
 * of `VITE_LOCAL_FIRST` (out of Sprint 13.10's scope, same as the custom report query/export/saved
 * report endpoints). Failures are swallowed rather than propagated so a missing connection doesn't
 * blank the rest of an otherwise fully-offline Reports page - the custom report builder just renders
 * with zero saved reports until reconnected. */
const fetchSavedReportsResilient = async (): Promise<SavedReport[]> => {
    try {
        const response = await axiosInstance.get<ApiResponse<SavedReport[]>>(API_PATHS.REPORTS.SAVED)
        return unwrapApiData(response)
    } catch {
        return []
    }
}

const fetchServerReports = async (
    periodParams: ReportPeriodQuery,
    periodDates: PeriodDates,
    chartQuery: ChartQuery,
    thisMonthQuery: ChartQuery
): Promise<ReportsData> => {
    try {
        const [
            averagesRes,
            largestRes,
            trendsRes,
            comparisonRes,
            savingsRes,
            recurringRes,
            categoryRes,
            budgetAnalysisRes,
            spendingAnalysisRes,
            crossoverRes,
            savedReportsRes,
            cashFlowRes,
            netWorthRes,
            budgetOverviewRes,
            thisMonthRes,
            rulesRes,
            draftsRes,
        ] = await Promise.all([
            axiosInstance.get<ApiResponse<PeriodAverages>>(API_PATHS.REPORTS.AVERAGES, { params: periodParams }),
            axiosInstance.get<ApiResponse<LargestExpensesResponse>>(API_PATHS.REPORTS.LARGEST_EXPENSES, {
                params: { ...periodParams, limit: 10 },
            }),
            axiosInstance.get<ApiResponse<SpendingTrendsResponse>>(API_PATHS.REPORTS.SPENDING_TRENDS, {
                params: periodParams,
            }),
            axiosInstance.get<ApiResponse<IncomeVsExpenseResponse>>(API_PATHS.REPORTS.INCOME_VS_EXPENSE, {
                params: periodParams,
            }),
            axiosInstance.get<ApiResponse<SavingsRateReport>>(API_PATHS.REPORTS.SAVINGS_RATE, { params: periodParams }),
            axiosInstance.get<ApiResponse<RecurringTotalsReport>>(API_PATHS.REPORTS.RECURRING_TOTALS, {
                params: periodParams,
            }),
            axiosInstance.get<ApiResponse<{ breakdown: CategoryBreakdownItem[] }>>(
                API_PATHS.DASHBOARD.CATEGORY_BREAKDOWN,
                { params: { startDate: periodDates.startDate, endDate: periodDates.endDate, type: 'expense' } }
            ),
            axiosInstance.get<ApiResponse<BudgetAnalysisReport>>(API_PATHS.REPORTS.BUDGET_ANALYSIS, {
                params: periodParams,
            }),
            axiosInstance.get<ApiResponse<SpendingAnalysisReport>>(API_PATHS.REPORTS.SPENDING_ANALYSIS, {
                params: periodParams,
            }),
            axiosInstance.get<ApiResponse<CrossoverPointReport>>(API_PATHS.REPORTS.CROSSOVER_POINT, {
                params: periodParams,
            }),
            axiosInstance.get<ApiResponse<SavedReport[]>>(API_PATHS.REPORTS.SAVED),
            axiosInstance.get<ApiResponse<DashboardCashFlowResponse>>(API_PATHS.DASHBOARD.CASH_FLOW, {
                params: chartQuery,
            }),
            axiosInstance.get<ApiResponse<NetWorthTrendResponse>>(API_PATHS.DASHBOARD.NET_WORTH_TREND, {
                params: chartQuery,
            }),
            axiosInstance.get<ApiResponse<BudgetOverviewResponse>>(API_PATHS.DASHBOARD.BUDGET_OVERVIEW),
            axiosInstance.get<ApiResponse<DashboardCashFlowResponse>>(API_PATHS.DASHBOARD.CASH_FLOW, {
                params: thisMonthQuery,
            }),
            axiosInstance.get<ApiResponse<RecurringRule[]>>(API_PATHS.RECURRING_RULES.GET_ALL, {
                params: { includeArchived: false },
            }),
            axiosInstance.get<ApiResponse<Transaction[]>>(API_PATHS.RECURRING_RULES.GET_DRAFTS),
        ])

        const categoryPayload = unwrapApiData(categoryRes)

        return {
            averages: unwrapApiData(averagesRes),
            largestExpenses: unwrapApiData(largestRes),
            spendingTrends: unwrapApiData(trendsRes),
            incomeVsExpense: unwrapApiData(comparisonRes),
            savingsRate: unwrapApiData(savingsRes),
            recurringTotals: unwrapApiData(recurringRes),
            categoryBreakdown: categoryPayload.breakdown,
            budgetAnalysis: unwrapApiData(budgetAnalysisRes),
            spendingAnalysis: unwrapApiData(spendingAnalysisRes),
            crossoverPoint: unwrapApiData(crossoverRes),
            savedReports: unwrapApiData(savedReportsRes),
            cashFlow: unwrapApiData(cashFlowRes),
            netWorthTrend: unwrapApiData(netWorthRes),
            budgetOverview: unwrapApiData(budgetOverviewRes),
            thisMonthCashFlow: unwrapApiData(thisMonthRes),
            recurringRules: unwrapApiData(rulesRes),
            recurringDrafts: unwrapApiData(draftsRes),
        }
    } catch (error) {
        throw new Error(getApiErrorMessage(error, 'Failed to load reports'))
    }
}

const fetchLocalReports = async (
    db: LocalDb,
    periodParams: ReportPeriodQuery,
    periodDates: PeriodDates,
    chartQuery: ChartQuery,
    thisMonthQuery: ChartQuery,
    timezone: string,
    preferredCurrency: string,
    exchangeRates: Record<string, number>
): Promise<ReportsData> => {
    const conversion = { preferredCurrency, exchangeRates }
    const period = resolveLocalReportPeriod(periodParams, timezone)

    const [
        averages,
        largestExpenses,
        spendingTrends,
        incomeVsExpense,
        savingsRate,
        recurringTotals,
        categoryBreakdown,
        budgetAnalysis,
        spendingAnalysis,
        crossoverPoint,
        cashFlowSeries,
        netWorthTrend,
        budgetOverview,
        thisMonthSeries,
        recurringRules,
        recurringDrafts,
        savedReports,
    ] = await Promise.all([
        computeLocalPeriodAverages(db, period, timezone),
        computeLocalLargestExpenses(db, period, 10),
        computeLocalSpendingTrends(db, period, timezone),
        computeLocalIncomeVsExpense(db, period),
        computeLocalSavingsRate(db, period),
        computeLocalRecurringTotals(db, period),
        computeLocalCategoryBreakdown(db, periodDates.startDate, periodDates.endDate, 'expense', timezone),
        computeLocalBudgetAnalysis(db, period),
        computeLocalSpendingAnalysis(db, period, timezone, 10),
        computeLocalCrossoverPoint(db, period, timezone),
        computeLocalCashFlowSeries(db, chartQuery.startDate, chartQuery.endDate, chartQuery.groupBy, timezone),
        computeLocalNetWorthOverview(db, chartQuery.startDate, chartQuery.endDate, timezone, conversion),
        computeLocalBudgetOverview(db, timezone),
        computeLocalCashFlowSeries(db, thisMonthQuery.startDate, thisMonthQuery.endDate, thisMonthQuery.groupBy, timezone),
        listLocalRecurringRules(db),
        listLocalRecurringDrafts(db),
        fetchSavedReportsResilient(),
    ])

    return {
        averages,
        largestExpenses,
        spendingTrends,
        incomeVsExpense,
        savingsRate,
        recurringTotals,
        categoryBreakdown,
        budgetAnalysis,
        spendingAnalysis,
        crossoverPoint,
        savedReports,
        cashFlow: {
            series: cashFlowSeries,
            groupBy: chartQuery.groupBy,
            periodStart: chartQuery.startDate,
            periodEnd: chartQuery.endDate,
        },
        netWorthTrend,
        budgetOverview,
        thisMonthCashFlow: {
            series: thisMonthSeries,
            groupBy: thisMonthQuery.groupBy,
            periodStart: thisMonthQuery.startDate,
            periodEnd: thisMonthQuery.endDate,
        },
        recurringRules,
        recurringDrafts,
    }
}

/**
 * `Reports.tsx`'s data layer, split local-first vs. server per Sprint 13.9's page-migration pattern
 * (see `useDashboardSummaryData.ts`). `savedReportsKey` is accepted for parity with the page's
 * existing "bump a counter to force a refetch after a saved-report CRUD" pattern; the local branch
 * also depends on it so editing a saved report refetches even though the rest of the local
 * computation is unaffected by it.
 */
export const useReportsData = (
    periodParams: ReportPeriodQuery,
    periodDates: PeriodDates,
    chartQuery: ChartQuery,
    thisMonthQuery: ChartQuery,
    savedReportsKey: number
): UseReportsDataResult => {
    const { user } = useUser()
    const localFirst = isLocalFirstEnabled()

    const timezone = user?.timezone || 'UTC'
    const preferredCurrency = user?.preferredCurrency ?? 'USD'
    const exchangeRates = user?.exchangeRates ?? {}

    // `useAsyncData` must still be called unconditionally (rules of hooks) even when local-first is
    // on and its result is discarded below - guard the fetcher itself so no real network request
    // goes out in that case (mirrors `useDashboardSummaryData.ts`'s `localFirst` guard).
    const serverResult = useAsyncData(
        useCallback(
            () =>
                localFirst
                    ? Promise.resolve(null as unknown as ReportsData)
                    : fetchServerReports(periodParams, periodDates, chartQuery, thisMonthQuery),
            [localFirst, periodParams, periodDates, chartQuery, thisMonthQuery]
        ),
        [periodParams, periodDates, chartQuery, thisMonthQuery, savedReportsKey, localFirst]
    )

    const localResult = useLocalQuery(
        ['accounts', 'transactions', 'categories', 'budgets', 'recurringRules', '_prefs'],
        useCallback(
            (db) =>
                fetchLocalReports(
                    db,
                    periodParams,
                    periodDates,
                    chartQuery,
                    thisMonthQuery,
                    timezone,
                    preferredCurrency,
                    exchangeRates
                ),
            // eslint-disable-next-line react-hooks/exhaustive-deps
            [periodParams, periodDates, chartQuery, thisMonthQuery, savedReportsKey, timezone, preferredCurrency, exchangeRates]
        )
    )

    return localFirst ? localResult : serverResult
}
