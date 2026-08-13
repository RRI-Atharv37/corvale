import React, { useCallback, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'
import { IoDownload } from 'react-icons/io5'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import CustomReportBuilder from '../../components/reports/CustomReportBuilder'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import {
    buildExportFilename,
    downloadExportBlob,
    ensureExportBlob,
    EXPORT_FORMAT_OPTIONS,
    type ExportFormat,
} from '../../utils/downloadExport'
import { useAsyncData } from '../../hooks/useAsyncData'
import type {
    ApiResponse,
    BudgetAnalysisReport,
    CrossoverPointReport,
    IncomeVsExpenseResponse,
    LargestExpensesResponse,
    PeriodAverages,
    RecurringTotalsReport,
    ReportMetricKey,
    ReportPeriodType,
    SavedReport,
    SavingsRateReport,
    SpendingAnalysisReport,
    SpendingTrendsResponse,
} from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import {
    formatContributionDate,
    formatCurrency,
    getCurrentMonthYear,
    toDateInputValue,
} from '../../utils/format'
import {
    axisTick,
    barChartTooltipProps,
    CHART_COLORS,
    chartMargin,
    chartTooltipProps,
    formatChartCurrency,
    formatPeriodLabel,
    yAxisTick,
} from '../../components/dashboard/chartTheme'
import CategoryBreakdownChart from '../../components/dashboard/CategoryBreakdownChart'
import IncomeOverTimeChart from '../../components/dashboard/IncomeOverTimeChart'
import SpendingOverTimeChart from '../../components/dashboard/SpendingOverTimeChart'
import CashFlowChart from '../../components/dashboard/CashFlowChart'
import NetWorthChart from '../../components/dashboard/NetWorthChart'
import BudgetOverviewChart from '../../components/dashboard/BudgetOverviewChart'
import DashboardCalendarCard from '../../components/dashboard/DashboardCalendarCard'
import ThisMonthChart from '../../components/dashboard/ThisMonthChart'
import type {
    BudgetOverviewResponse,
    CategoryBreakdownItem,
    DashboardCashFlowResponse,
    DashboardGroupBy,
    NetWorthTrendResponse,
    RecurringRule,
    Transaction,
} from '../../types/api'

interface ReportsData {
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

const resolveGroupByFromDates = (startDate: string, endDate: string): DashboardGroupBy => {
    const start = new Date(`${startDate}T12:00:00`)
    const end = new Date(`${endDate}T12:00:00`)
    const sameMonth =
        start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()
    return sameMonth ? 'day' : 'month'
}

const resolveThisMonthRange = (): { startDate: string; endDate: string } => {
    const { year, month } = getCurrentMonthYear()
    const endDate = toDateInputValue(new Date())
    return { startDate: `${year}-${String(month).padStart(2, '0')}-01`, endDate }
}

const MONTH_OPTIONS = [
    { value: '1', label: 'January' },
    { value: '2', label: 'February' },
    { value: '3', label: 'March' },
    { value: '4', label: 'April' },
    { value: '5', label: 'May' },
    { value: '6', label: 'June' },
    { value: '7', label: 'July' },
    { value: '8', label: 'August' },
    { value: '9', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
]

const METRIC_OPTIONS: { key: ReportMetricKey; label: string }[] = [
    { key: 'summary', label: 'Dashboard summary' },
    { key: 'averages', label: 'Period averages' },
    { key: 'largestExpenses', label: 'Largest expenses' },
    { key: 'spendingTrends', label: 'Spending trends' },
    { key: 'incomeVsExpense', label: 'Income vs expense' },
    { key: 'savingsRate', label: 'Savings rate' },
    { key: 'recurringTotals', label: 'Recurring totals' },
    { key: 'categoryBreakdown', label: 'Category breakdown' },
    { key: 'budgetAnalysis', label: 'Budget analysis' },
    { key: 'spendingAnalysis', label: 'Spending analysis' },
    { key: 'crossoverPoint', label: 'Crossover point' },
]

const DEFAULT_METRICS: ReportMetricKey[] = [
    'summary',
    'averages',
    'largestExpenses',
    'spendingTrends',
    'incomeVsExpense',
    'savingsRate',
    'recurringTotals',
    'categoryBreakdown',
    'budgetAnalysis',
    'spendingAnalysis',
    'crossoverPoint',
]

const Reports = () => {
    const { year, month } = getCurrentMonthYear()
    const today = toDateInputValue(new Date())
    const sixMonthsAgo = toDateInputValue(new Date(new Date().setMonth(new Date().getMonth() - 5, 1)))

    const [periodType, setPeriodType] = useState<ReportPeriodType>('custom')
    const [reportYear, setReportYear] = useState(String(year))
    const [reportMonth, setReportMonth] = useState(String(month))
    const [startDate, setStartDate] = useState(sixMonthsAgo)
    const [endDate, setEndDate] = useState(today)
    const [selectedMetrics, setSelectedMetrics] = useState<ReportMetricKey[]>(DEFAULT_METRICS)
    const [exportFormat, setExportFormat] = useState<ExportFormat>('csv')
    const [exporting, setExporting] = useState(false)
    const [savedReportsKey, setSavedReportsKey] = useState(0)

    const periodDates = useMemo(() => {
        if (periodType === 'monthly') {
            const monthNum = Number(reportMonth)
            const yearNum = Number(reportYear)
            const endDay = new Date(yearNum, monthNum, 0).getDate()
            const paddedMonth = String(monthNum).padStart(2, '0')
            return {
                startDate: `${reportYear}-${paddedMonth}-01`,
                endDate: `${reportYear}-${paddedMonth}-${String(endDay).padStart(2, '0')}`,
            }
        }
        if (periodType === 'yearly') {
            return { startDate: `${reportYear}-01-01`, endDate: `${reportYear}-12-31` }
        }
        return { startDate, endDate }
    }, [periodType, reportYear, reportMonth, startDate, endDate])

    const periodParams = useMemo(() => {
        if (periodType === 'monthly') {
            return { periodType, year: reportYear, month: reportMonth }
        }
        if (periodType === 'yearly') {
            return { periodType, year: reportYear }
        }
        return { periodType, startDate, endDate }
    }, [periodType, reportYear, reportMonth, startDate, endDate])

    const chartQuery = useMemo(() => {
        const groupBy = resolveGroupByFromDates(periodDates.startDate, periodDates.endDate)
        return { startDate: periodDates.startDate, endDate: periodDates.endDate, groupBy }
    }, [periodDates])

    const thisMonthQuery = useMemo(() => {
        const { startDate, endDate } = resolveThisMonthRange()
        return { startDate, endDate, groupBy: 'day' as DashboardGroupBy }
    }, [])

    const fetchReports = useCallback(async (): Promise<ReportsData> => {
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
                axiosInstance.get<ApiResponse<PeriodAverages>>(API_PATHS.REPORTS.AVERAGES, {
                    params: periodParams,
                }),
                axiosInstance.get<ApiResponse<LargestExpensesResponse>>(API_PATHS.REPORTS.LARGEST_EXPENSES, {
                    params: { ...periodParams, limit: 10 },
                }),
                axiosInstance.get<ApiResponse<SpendingTrendsResponse>>(API_PATHS.REPORTS.SPENDING_TRENDS, {
                    params: periodParams,
                }),
                axiosInstance.get<ApiResponse<IncomeVsExpenseResponse>>(API_PATHS.REPORTS.INCOME_VS_EXPENSE, {
                    params: periodParams,
                }),
                axiosInstance.get<ApiResponse<SavingsRateReport>>(API_PATHS.REPORTS.SAVINGS_RATE, {
                    params: periodParams,
                }),
                axiosInstance.get<ApiResponse<RecurringTotalsReport>>(API_PATHS.REPORTS.RECURRING_TOTALS, {
                    params: periodParams,
                }),
                axiosInstance.get<ApiResponse<{ breakdown: CategoryBreakdownItem[] }>>(
                    API_PATHS.DASHBOARD.CATEGORY_BREAKDOWN,
                    {
                        params: {
                            startDate: periodDates.startDate,
                            endDate: periodDates.endDate,
                            type: 'expense',
                        },
                    }
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
    }, [periodParams, periodDates, chartQuery, thisMonthQuery, savedReportsKey])

    const { data, loading, error, refetch } = useAsyncData(fetchReports, [fetchReports])

    const toggleMetric = (metric: ReportMetricKey) => {
        setSelectedMetrics((current) =>
            current.includes(metric)
                ? current.filter((item) => item !== metric)
                : [...current, metric]
        )
    }

    const handleExport = async () => {
        if (selectedMetrics.length === 0) {
            toast.error('Select at least one metric to export')
            return
        }

        setExporting(true)
        try {
            const blobData = await axiosInstance.post<Blob>(
                API_PATHS.REPORTS.GENERATE,
                {
                    metrics: selectedMetrics,
                    format: exportFormat,
                    ...periodParams,
                },
                { responseType: 'blob' }
            )

            const blob = ensureExportBlob(blobData, exportFormat)
            const baseName = `spndr-report-${periodDates.startDate}-${periodDates.endDate}`
            downloadExportBlob(blob, buildExportFilename(baseName, exportFormat))
            toast.success('Report downloaded')
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to export report'))
        } finally {
            setExporting(false)
        }
    }

    const periodDescription =
        periodType === 'monthly'
            ? `${MONTH_OPTIONS.find((m) => m.value === reportMonth)?.label ?? ''} ${reportYear}`
            : periodType === 'yearly'
              ? reportYear
              : `${startDate} to ${endDate}`

    return (
        <div>
            <PageHeader
                title="Reports"
                description="Advanced analytics, trends, and exportable financial reports"
            />

            <div className="card mb-6 space-y-4">
                <div className="flex flex-wrap gap-2">
                    {(['monthly', 'yearly', 'custom'] as ReportPeriodType[]).map((type) => (
                        <button
                            key={type}
                            type="button"
                            onClick={() => setPeriodType(type)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors capitalize ${
                                periodType === type
                                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                                    : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                            }`}
                        >
                            {type}
                        </button>
                    ))}
                </div>

                {periodType === 'monthly' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <SelectField
                            label="Month"
                            value={reportMonth}
                            onChange={setReportMonth}
                            options={MONTH_OPTIONS}
                        />
                        <SelectField
                            label="Year"
                            value={reportYear}
                            onChange={setReportYear}
                            options={Array.from({ length: 6 }, (_, index) => {
                                const y = year - index
                                return { value: String(y), label: String(y) }
                            })}
                        />
                    </div>
                )}

                {periodType === 'yearly' && (
                    <SelectField
                        label="Year"
                        value={reportYear}
                        onChange={setReportYear}
                        options={Array.from({ length: 6 }, (_, index) => {
                            const y = year - index
                            return { value: String(y), label: String(y) }
                        })}
                    />
                )}

                {periodType === 'custom' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <DateField label="Start date" value={startDate} onChange={setStartDate} />
                        <DateField label="End date" value={endDate} onChange={setEndDate} />
                    </div>
                )}
            </div>

            <AsyncContent
                loading={loading}
                error={error}
                data={data}
                isEmpty={() => false}
                loadingMessage="Loading reports..."
                emptyTitle="No report data"
                emptyDescription="Add transactions to generate reports."
                onRetry={refetch}
            >
                {(reports) => (
                    <div className="space-y-6">
                        <p className="text-xs text-slate-500">
                            Showing reports for <span className="text-slate-300">{periodDescription}</span>
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <MetricCard
                                label="Savings rate"
                                value={`${reports.savingsRate.savingsRate.toFixed(1)}%`}
                                subtitle={`${formatCurrency(reports.savingsRate.netSavings)} saved`}
                                accent="cyan"
                            />
                            <MetricCard
                                label={`Avg ${reports.averages.unit === 'day' ? 'daily' : 'monthly'} income`}
                                value={formatCurrency(reports.averages.averageIncome)}
                                subtitle={`Across ${reports.averages.unitCount} ${reports.averages.unit}s`}
                                accent="cyan"
                            />
                            <MetricCard
                                label={`Avg ${reports.averages.unit === 'day' ? 'daily' : 'monthly'} spending`}
                                value={formatCurrency(reports.averages.averageExpenses)}
                                subtitle={`Total ${formatCurrency(reports.averages.totalExpenses)}`}
                                accent="rose"
                            />
                            <MetricCard
                                label="Recurring (monthly eq.)"
                                value={formatCurrency(reports.recurringTotals.totalMonthlyEquivalent)}
                                subtitle={`${reports.recurringTotals.activeExpenseRules.length} active rules`}
                                accent="violet"
                            />
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <ThisMonthChart
                                data={reports.thisMonthCashFlow.series}
                                groupBy={reports.thisMonthCashFlow.groupBy}
                                periodStart={reports.thisMonthCashFlow.periodStart}
                                periodEnd={reports.thisMonthCashFlow.periodEnd}
                            />
                            <NetWorthChart
                                series={reports.netWorthTrend.series}
                                currentBalances={reports.netWorthTrend.currentBalances}
                                balanceSource={reports.netWorthTrend.balanceSource}
                            />
                        </div>

                        <CashFlowChart data={reports.cashFlow.series} groupBy={reports.cashFlow.groupBy} />

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <IncomeOverTimeChart
                                data={reports.cashFlow.series}
                                groupBy={reports.cashFlow.groupBy}
                            />
                            <SpendingOverTimeChart
                                data={reports.cashFlow.series}
                                groupBy={reports.cashFlow.groupBy}
                            />
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <IncomeVsExpenseChart data={reports.incomeVsExpense} />
                            <SpendingTrendsChart data={reports.spendingTrends.trends} />
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <div className="card">
                                <h3 className="text-sm font-medium text-slate-200">Largest expenses</h3>
                                <p className="text-xs text-slate-500 mt-1">Top posted expenses in this period</p>
                                {reports.largestExpenses.expenses.length === 0 ? (
                                    <p className="text-sm text-slate-500 mt-6 text-center py-8">
                                        No expenses in this period.
                                    </p>
                                ) : (
                                    <ul className="mt-4 divide-y divide-slate-800">
                                        {reports.largestExpenses.expenses.map((expense, index) => (
                                            <li
                                                key={expense.transactionId}
                                                className="py-3 flex items-start justify-between gap-3"
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-sm text-slate-200 truncate">
                                                        {index + 1}. {expense.title}
                                                    </p>
                                                    <p className="text-xs text-slate-500 mt-0.5">
                                                        {expense.categoryName} ·{' '}
                                                        {formatContributionDate(expense.date)}
                                                    </p>
                                                </div>
                                                <p className="text-sm font-medium text-rose-300 shrink-0">
                                                    {formatCurrency(expense.amount, expense.currency)}
                                                </p>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            <div className="card">
                                <h3 className="text-sm font-medium text-slate-200">Recurring expense totals</h3>
                                <p className="text-xs text-slate-500 mt-1">
                                    Active rules normalized to monthly · posted recurring in period
                                </p>
                                <div className="mt-4 grid grid-cols-2 gap-3">
                                    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                                        <p className="text-xs text-slate-500">Monthly equivalent</p>
                                        <p className="text-lg font-semibold text-violet-300 mt-1">
                                            {formatCurrency(reports.recurringTotals.totalMonthlyEquivalent)}
                                        </p>
                                    </div>
                                    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                                        <p className="text-xs text-slate-500">Posted in period</p>
                                        <p className="text-lg font-semibold text-rose-300 mt-1">
                                            {formatCurrency(
                                                reports.recurringTotals.postedRecurringExpensesInPeriod
                                            )}
                                        </p>
                                    </div>
                                </div>
                                {reports.recurringTotals.activeExpenseRules.length > 0 && (
                                    <ul className="mt-4 divide-y divide-slate-800">
                                        {reports.recurringTotals.activeExpenseRules.map((rule) => (
                                            <li
                                                key={rule.ruleId}
                                                className="py-2.5 flex items-center justify-between gap-3"
                                            >
                                                <div>
                                                    <p className="text-sm text-slate-200">{rule.title}</p>
                                                    <p className="text-xs text-slate-500 capitalize">
                                                        {rule.interval} · {formatCurrency(rule.amount)}/occurrence
                                                    </p>
                                                </div>
                                                <p className="text-sm text-slate-300">
                                                    {formatCurrency(rule.monthlyEquivalent)}/mo
                                                </p>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>

                        <CategoryBreakdownChart data={reports.categoryBreakdown} />

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <BudgetOverviewChart
                                budgets={reports.budgetOverview.budgets}
                                periodStart={reports.budgetOverview.periodStart}
                                periodEnd={reports.budgetOverview.periodEnd}
                            />
                            <DashboardCalendarCard
                                rules={reports.recurringRules}
                                drafts={reports.recurringDrafts}
                            />
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <BudgetAnalysisSection data={reports.budgetAnalysis} />
                            <CrossoverPointChart data={reports.crossoverPoint} />
                        </div>

                        <SpendingAnalysisSection data={reports.spendingAnalysis} />

                        <CustomReportBuilder
                            periodType={periodType}
                            reportYear={reportYear}
                            reportMonth={reportMonth}
                            startDate={startDate}
                            endDate={endDate}
                            savedReports={reports.savedReports}
                            onSavedReportsChange={() => setSavedReportsKey((key) => key + 1)}
                        />

                        <div className="card">
                            <h3 className="text-sm font-medium text-slate-200">Custom report export</h3>
                            <p className="text-xs text-slate-500 mt-1">
                                Choose metrics and download a report for {periodDescription}
                            </p>

                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                                {METRIC_OPTIONS.map((option) => (
                                    <label
                                        key={option.key}
                                        className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedMetrics.includes(option.key)}
                                            onChange={() => toggleMetric(option.key)}
                                            className="rounded border-slate-600 bg-slate-900 text-cyan-500 focus:ring-cyan-500/30"
                                        />
                                        {option.label}
                                    </label>
                                ))}
                            </div>

                            <div className="mt-4 flex flex-col sm:flex-row sm:items-end gap-3">
                                <div>
                                    <label className="text-[13px] text-slate-300">Format</label>
                                    <div className="input-box mb-0 mt-1">
                                        <select
                                            value={exportFormat}
                                            onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                                            className="w-full bg-transparent outline-none text-slate-200 min-w-[120px]"
                                        >
                                            {EXPORT_FORMAT_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value} className="bg-slate-900">
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleExport}
                                    disabled={exporting || selectedMetrics.length === 0}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-[42px]"
                                >
                                    <IoDownload size={16} />
                                    {exporting ? 'Exporting...' : 'Download report'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </AsyncContent>
        </div>
    )
}

interface MetricCardProps {
    label: string
    value: string
    subtitle: string
    accent: 'cyan' | 'rose' | 'violet'
}

const accentClasses: Record<MetricCardProps['accent'], string> = {
    cyan: 'border-cyan-500/20 bg-cyan-500/5',
    rose: 'border-rose-500/20 bg-rose-500/5',
    violet: 'border-violet-500/20 bg-violet-500/5',
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, subtitle, accent }) => (
    <div className={`card ${accentClasses[accent]}`}>
        <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-semibold text-slate-100 mt-2">{value}</p>
        <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
    </div>
)

const IncomeVsExpenseChart: React.FC<{ data: IncomeVsExpenseResponse }> = ({ data }) => {
    const chartData = [
        { label: 'Income', amount: data.totalIncome, fill: CHART_COLORS.income },
        { label: 'Expenses', amount: data.totalExpenses, fill: CHART_COLORS.expense },
        { label: 'Net savings', amount: data.netSavings, fill: CHART_COLORS.net },
    ]

    return (
        <div className="card">
            <h3 className="text-sm font-medium text-slate-200">Income vs expense</h3>
            <p className="text-xs text-slate-500 mt-1">
                Ratio {data.expenseToIncomeRatio.toFixed(2)} ·{' '}
                {Math.round(data.incomeShare * 100)}% income / {Math.round(data.expenseShare * 100)}% expenses
            </p>
            <div className="h-72 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={chartMargin}>
                        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                        <YAxis
                            tick={yAxisTick}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={formatChartCurrency}
                            width={52}
                        />
                        <Tooltip
                            {...barChartTooltipProps}
                            formatter={(value: number) => formatCurrency(value)}
                        />
                        <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={48} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}

const SpendingTrendsChart: React.FC<{ data: SpendingTrendsResponse['trends'] }> = ({ data }) => {
    const chartData = data.map((point) => ({
        ...point,
        label: formatPeriodLabel(point.period, 'month'),
    }))

    return (
        <div className="card">
            <h3 className="text-sm font-medium text-slate-200">Spending trends</h3>
            <p className="text-xs text-slate-500 mt-1">Month-over-month spending with change indicators</p>
            <div className="h-72 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={chartMargin}>
                        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                        <YAxis
                            tick={yAxisTick}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={formatChartCurrency}
                            width={52}
                        />
                        <Tooltip
                            {...chartTooltipProps}
                            formatter={(value: number, _name, item) => {
                                const payload = item.payload as SpendingTrendsResponse['trends'][number] & {
                                    label: string
                                }
                                const change =
                                    payload.changePercent === null
                                        ? '-'
                                        : `${payload.changePercent > 0 ? '+' : ''}${payload.changePercent}%`
                                return [`${formatCurrency(value)} (${change})`, 'Spending']
                            }}
                        />
                        <Line
                            type="monotone"
                            dataKey="expense"
                            stroke={CHART_COLORS.expense}
                            strokeWidth={2}
                            dot={{ r: 3, fill: CHART_COLORS.expense }}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}

interface SelectFieldProps {
    label: string
    value: string
    onChange: (value: string) => void
    options: { value: string; label: string }[]
}

const SelectField: React.FC<SelectFieldProps> = ({ label, value, onChange, options }) => (
    <label className="block">
        <span className="text-xs text-slate-400">{label}</span>
        <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
        >
            {options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    </label>
)

interface DateFieldProps {
    label: string
    value: string
    onChange: (value: string) => void
}

const DateField: React.FC<DateFieldProps> = ({ label, value, onChange }) => (
    <label className="block">
        <span className="text-xs text-slate-400">{label}</span>
        <input
            type="date"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
        />
    </label>
)

const BudgetAnalysisSection: React.FC<{ data: BudgetAnalysisReport }> = ({ data }) => (
    <div className="card">
        <h3 className="text-sm font-medium text-slate-200">Budget analysis</h3>
        <p className="text-xs text-slate-500 mt-1">
            {data.budgets.length} budget{data.budgets.length === 1 ? '' : 's'} in period ·{' '}
            {data.overBudgetCount} over · {data.underBudgetCount} under
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-xs text-slate-500">Total budgeted</p>
                <p className="text-lg font-semibold text-violet-300 mt-1">{formatCurrency(data.totalBudgeted)}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-xs text-slate-500">Total spent</p>
                <p className="text-lg font-semibold text-rose-300 mt-1">{formatCurrency(data.totalSpent)}</p>
            </div>
        </div>
        {data.budgets.length === 0 ? (
            <p className="text-sm text-slate-500 mt-6 text-center py-6">No budgets overlap this period.</p>
        ) : (
            <ul className="mt-4 divide-y divide-slate-800">
                {data.budgets.map((budget) => (
                    <li key={budget.budgetId} className="py-2.5 flex items-center justify-between gap-3">
                        <div>
                            <p className="text-sm text-slate-200">{budget.name ?? budget.categoryName ?? 'Overall'}</p>
                            <p className="text-xs text-slate-500">{budget.percentUsed.toFixed(0)}% used</p>
                        </div>
                        <p className="text-sm text-slate-300">
                            {formatCurrency(budget.spent)} / {formatCurrency(budget.budgetAmount)}
                        </p>
                    </li>
                ))}
            </ul>
        )}
    </div>
)

const SpendingAnalysisSection: React.FC<{ data: SpendingAnalysisReport }> = ({ data }) => (
    <div className="card">
        <h3 className="text-sm font-medium text-slate-200">Spending analysis</h3>
        <p className="text-xs text-slate-500 mt-1">
            {data.transactionCount} transactions · avg {formatCurrency(data.averagePerTransaction)} per transaction
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-xs text-slate-500">Total spending</p>
                <p className="text-lg font-semibold text-rose-300 mt-1">{formatCurrency(data.totalExpenses)}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-xs text-slate-500">Top category</p>
                <p className="text-sm font-medium text-slate-200 mt-1">
                    {data.topCategories[0]?.categoryName ?? '-'}
                </p>
                {data.topCategories[0] && (
                    <p className="text-xs text-slate-500">{formatCurrency(data.topCategories[0].amount)}</p>
                )}
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-xs text-slate-500">Top payment type</p>
                <p className="text-sm font-medium text-slate-200 mt-1">
                    {data.topPaymentMethods[0]?.paymentMethod ?? '-'}
                </p>
                {data.topPaymentMethods[0] && (
                    <p className="text-xs text-slate-500">{formatCurrency(data.topPaymentMethods[0].amount)}</p>
                )}
            </div>
        </div>
    </div>
)

const CrossoverPointChart: React.FC<{ data: CrossoverPointReport }> = ({ data }) => {
    const chartData = data.series.map((point) => ({
        ...point,
        label: formatPeriodLabel(point.period, 'month'),
    }))

    return (
        <div className="card">
            <h3 className="text-sm font-medium text-slate-200">Crossover point</h3>
            <p className="text-xs text-slate-500 mt-1">
                {data.hasCrossover
                    ? `Cumulative income exceeded expenses in ${data.crossoverPeriod}`
                    : 'Income has not yet exceeded cumulative expenses in this period'}
                {data.monthlyCrossoverPeriod
                    ? ` · Monthly crossover: ${data.monthlyCrossoverPeriod}`
                    : ''}
            </p>
            <div className="h-72 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={chartMargin}>
                        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                        <YAxis
                            tick={yAxisTick}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={formatChartCurrency}
                            width={52}
                        />
                        <Tooltip
                            {...chartTooltipProps}
                            formatter={(value: number, name: string) => [
                                formatCurrency(value),
                                name === 'cumulativeIncome' ? 'Cumulative income' : 'Cumulative expenses',
                            ]}
                        />
                        <Legend
                            wrapperStyle={{ fontSize: '0.75rem', color: CHART_COLORS.axis }}
                            formatter={(value) =>
                                value === 'cumulativeIncome' ? 'Cumulative income' : 'Cumulative expenses'
                            }
                        />
                        <Line
                            type="monotone"
                            dataKey="cumulativeIncome"
                            stroke={CHART_COLORS.income}
                            strokeWidth={2}
                            dot={{ r: 2 }}
                        />
                        <Line
                            type="monotone"
                            dataKey="cumulativeExpense"
                            stroke={CHART_COLORS.expense}
                            strokeWidth={2}
                            dot={{ r: 2 }}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}

export default Reports
