import React, { ReactNode, useMemo, useState } from 'react'
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
import StatCard from '../../components/ui/StatCard'
import AsyncContent from '../../components/ui/AsyncContent'
import ErrorState from '../../components/ui/ErrorState'
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
import { useReportsData } from './hooks/useReportsData'
import type {
    BudgetAnalysisReport,
    CrossoverPointReport,
    IncomeVsExpenseResponse,
    ReportMetricKey,
    ReportPeriodType,
    SpendingAnalysisReport,
    SpendingTrendsResponse,
} from '../../types/api'
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
import type { DashboardGroupBy } from '../../types/api'

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

    const { data, sectionErrors, loading, error, refetch } = useReportsData(
        periodParams,
        periodDates,
        chartQuery,
        thisMonthQuery,
        savedReportsKey
    )

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
                                    ? 'border-accent/40 bg-accent-subtle text-accent'
                                    : 'border-border bg-surface/40 text-fg-muted hover:border-border hover:text-fg'
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
                        <p className="text-xs text-fg-muted">
                            Showing reports for <span className="text-fg-secondary">{periodDescription}</span>
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {sectionErrors.savingsRate ? (
                                <StatCardError label="Savings rate" message={sectionErrors.savingsRate} onRetry={refetch} />
                            ) : reports.savingsRate ? (
                                <StatCard
                                    label="Savings rate"
                                    value={`${reports.savingsRate.savingsRate.toFixed(1)}%`}
                                    subtitle={`${formatCurrency(reports.savingsRate.netSavings)} saved`}
                                    accent="income"
                                />
                            ) : null}

                            {sectionErrors.averages ? (
                                <StatCardError label="Average income" message={sectionErrors.averages} onRetry={refetch} />
                            ) : reports.averages ? (
                                <StatCard
                                    label={`Avg ${reports.averages.unit === 'day' ? 'daily' : 'monthly'} income`}
                                    value={formatCurrency(reports.averages.averageIncome)}
                                    subtitle={`Across ${reports.averages.unitCount} ${reports.averages.unit}s`}
                                    accent="income"
                                />
                            ) : null}

                            {sectionErrors.averages ? (
                                <StatCardError label="Average spending" message={sectionErrors.averages} onRetry={refetch} />
                            ) : reports.averages ? (
                                <StatCard
                                    label={`Avg ${reports.averages.unit === 'day' ? 'daily' : 'monthly'} spending`}
                                    value={formatCurrency(reports.averages.averageExpenses)}
                                    subtitle={`Total ${formatCurrency(reports.averages.totalExpenses)}`}
                                    accent="expense"
                                />
                            ) : null}

                            {sectionErrors.recurringTotals ? (
                                <StatCardError
                                    label="Recurring (monthly eq.)"
                                    message={sectionErrors.recurringTotals}
                                    onRetry={refetch}
                                />
                            ) : reports.recurringTotals ? (
                                <StatCard
                                    label="Recurring (monthly eq.)"
                                    value={formatCurrency(reports.recurringTotals.totalMonthlyEquivalent)}
                                    subtitle={`${reports.recurringTotals.activeExpenseRules.length} active rules`}
                                    accent="accent"
                                />
                            ) : null}
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <ReportSection
                                title="This month"
                                value={reports.thisMonthCashFlow}
                                error={sectionErrors.thisMonthCashFlow}
                                onRetry={refetch}
                                render={(thisMonthCashFlow) => (
                                    <ThisMonthChart
                                        data={thisMonthCashFlow.series}
                                        groupBy={thisMonthCashFlow.groupBy}
                                        periodStart={thisMonthCashFlow.periodStart}
                                        periodEnd={thisMonthCashFlow.periodEnd}
                                    />
                                )}
                            />
                            <ReportSection
                                title="Net worth trend"
                                value={reports.netWorthTrend}
                                error={sectionErrors.netWorthTrend}
                                onRetry={refetch}
                                render={(netWorthTrend) => (
                                    <NetWorthChart
                                        series={netWorthTrend.series}
                                        currentBalances={netWorthTrend.currentBalances}
                                        balanceSource={netWorthTrend.balanceSource}
                                    />
                                )}
                            />
                        </div>

                        <ReportSection
                            title="Cash flow"
                            value={reports.cashFlow}
                            error={sectionErrors.cashFlow}
                            onRetry={refetch}
                            render={(cashFlow) => <CashFlowChart data={cashFlow.series} groupBy={cashFlow.groupBy} />}
                        />

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <ReportSection
                                title="Income over time"
                                value={reports.cashFlow}
                                error={sectionErrors.cashFlow}
                                onRetry={refetch}
                                render={(cashFlow) => (
                                    <IncomeOverTimeChart data={cashFlow.series} groupBy={cashFlow.groupBy} />
                                )}
                            />
                            <ReportSection
                                title="Spending over time"
                                value={reports.cashFlow}
                                error={sectionErrors.cashFlow}
                                onRetry={refetch}
                                render={(cashFlow) => (
                                    <SpendingOverTimeChart data={cashFlow.series} groupBy={cashFlow.groupBy} />
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <ReportSection
                                title="Income vs expense"
                                value={reports.incomeVsExpense}
                                error={sectionErrors.incomeVsExpense}
                                onRetry={refetch}
                                render={(incomeVsExpense) => <IncomeVsExpenseChart data={incomeVsExpense} />}
                            />
                            <ReportSection
                                title="Spending trends"
                                value={reports.spendingTrends}
                                error={sectionErrors.spendingTrends}
                                onRetry={refetch}
                                render={(spendingTrends) => <SpendingTrendsChart data={spendingTrends.trends} />}
                            />
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <ReportSection
                                title="Largest expenses"
                                description="Top posted expenses in this period"
                                value={reports.largestExpenses}
                                error={sectionErrors.largestExpenses}
                                onRetry={refetch}
                                render={(largestExpenses) => (
                                    <div className="card">
                                        <h3 className="text-sm font-medium text-fg">Largest expenses</h3>
                                        <p className="text-xs text-fg-muted mt-1">Top posted expenses in this period</p>
                                        {largestExpenses.expenses.length === 0 ? (
                                            <p className="text-sm text-fg-muted mt-6 text-center py-8">
                                                No expenses in this period.
                                            </p>
                                        ) : (
                                            <ul className="mt-4 divide-y divide-slate-800">
                                                {largestExpenses.expenses.map((expense, index) => (
                                                    <li
                                                        key={expense.transactionId}
                                                        className="py-3 flex items-start justify-between gap-3"
                                                    >
                                                        <div className="min-w-0">
                                                            <p className="text-sm text-fg truncate">
                                                                {index + 1}. {expense.title}
                                                            </p>
                                                            <p className="text-xs text-fg-muted mt-0.5">
                                                                {expense.categoryName} ·{' '}
                                                                {formatContributionDate(expense.date)}
                                                            </p>
                                                        </div>
                                                        <p className="text-sm font-medium text-expense shrink-0">
                                                            {formatCurrency(expense.amount, expense.currency)}
                                                        </p>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )}
                            />

                            <ReportSection
                                title="Recurring expense totals"
                                description="Active rules normalized to monthly · posted recurring in period"
                                value={reports.recurringTotals}
                                error={sectionErrors.recurringTotals}
                                onRetry={refetch}
                                render={(recurringTotals) => (
                                    <div className="card">
                                        <h3 className="text-sm font-medium text-fg">Recurring expense totals</h3>
                                        <p className="text-xs text-fg-muted mt-1">
                                            Active rules normalized to monthly · posted recurring in period
                                        </p>
                                        <div className="mt-4 grid grid-cols-2 gap-3">
                                            <div className="rounded-lg border border-border-subtle bg-surface/50 p-3">
                                                <p className="text-xs text-fg-muted">Monthly equivalent</p>
                                                <p className="text-lg font-semibold text-violet-300 mt-1">
                                                    {formatCurrency(recurringTotals.totalMonthlyEquivalent)}
                                                </p>
                                            </div>
                                            <div className="rounded-lg border border-border-subtle bg-surface/50 p-3">
                                                <p className="text-xs text-fg-muted">Posted in period</p>
                                                <p className="text-lg font-semibold text-expense mt-1">
                                                    {formatCurrency(recurringTotals.postedRecurringExpensesInPeriod)}
                                                </p>
                                            </div>
                                        </div>
                                        {recurringTotals.activeExpenseRules.length > 0 && (
                                            <ul className="mt-4 divide-y divide-slate-800">
                                                {recurringTotals.activeExpenseRules.map((rule) => (
                                                    <li
                                                        key={rule.ruleId}
                                                        className="py-2.5 flex items-center justify-between gap-3"
                                                    >
                                                        <div>
                                                            <p className="text-sm text-fg">{rule.title}</p>
                                                            <p className="text-xs text-fg-muted capitalize">
                                                                {rule.interval} · {formatCurrency(rule.amount)}/occurrence
                                                            </p>
                                                        </div>
                                                        <p className="text-sm text-fg-secondary">
                                                            {formatCurrency(rule.monthlyEquivalent)}/mo
                                                        </p>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )}
                            />
                        </div>

                        <ReportSection
                            title="Category breakdown"
                            value={reports.categoryBreakdown}
                            error={sectionErrors.categoryBreakdown}
                            onRetry={refetch}
                            render={(categoryBreakdown) => <CategoryBreakdownChart data={categoryBreakdown} />}
                        />

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <ReportSection
                                title="Budget overview"
                                value={reports.budgetOverview}
                                error={sectionErrors.budgetOverview}
                                onRetry={refetch}
                                render={(budgetOverview) => (
                                    <BudgetOverviewChart
                                        budgets={budgetOverview.budgets}
                                        periodStart={budgetOverview.periodStart}
                                        periodEnd={budgetOverview.periodEnd}
                                    />
                                )}
                            />

                            {sectionErrors.recurringRules || sectionErrors.recurringDrafts ? (
                                <div className="card">
                                    <h3 className="text-sm font-medium text-fg">Calendar</h3>
                                    <p className="text-xs text-fg-muted mt-1">Recurring bills and upcoming drafts</p>
                                    <ErrorState
                                        message={sectionErrors.recurringRules ?? sectionErrors.recurringDrafts}
                                        onRetry={refetch}
                                    />
                                </div>
                            ) : reports.recurringRules && reports.recurringDrafts ? (
                                <DashboardCalendarCard rules={reports.recurringRules} drafts={reports.recurringDrafts} />
                            ) : null}
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <ReportSection
                                title="Budget analysis"
                                value={reports.budgetAnalysis}
                                error={sectionErrors.budgetAnalysis}
                                onRetry={refetch}
                                render={(budgetAnalysis) => <BudgetAnalysisSection data={budgetAnalysis} />}
                            />
                            <ReportSection
                                title="Crossover point"
                                value={reports.crossoverPoint}
                                error={sectionErrors.crossoverPoint}
                                onRetry={refetch}
                                render={(crossoverPoint) => <CrossoverPointChart data={crossoverPoint} />}
                            />
                        </div>

                        <ReportSection
                            title="Spending analysis"
                            value={reports.spendingAnalysis}
                            error={sectionErrors.spendingAnalysis}
                            onRetry={refetch}
                            render={(spendingAnalysis) => <SpendingAnalysisSection data={spendingAnalysis} />}
                        />

                        <ReportSection
                            title="Custom reports"
                            description="Build visual reports by split, chart type, and date range - save configs to reuse"
                            value={reports.savedReports}
                            error={sectionErrors.savedReports}
                            onRetry={refetch}
                            render={(savedReports) => (
                                <CustomReportBuilder
                                    periodType={periodType}
                                    reportYear={reportYear}
                                    reportMonth={reportMonth}
                                    startDate={startDate}
                                    endDate={endDate}
                                    savedReports={savedReports}
                                    onSavedReportsChange={() => setSavedReportsKey((key) => key + 1)}
                                />
                            )}
                        />

                        <div className="card">
                            <h3 className="text-sm font-medium text-fg">Custom report export</h3>
                            <p className="text-xs text-fg-muted mt-1">
                                Choose metrics and download a report for {periodDescription}
                            </p>

                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                                {METRIC_OPTIONS.map((option) => (
                                    <label
                                        key={option.key}
                                        className="flex items-center gap-2 text-sm text-fg-secondary cursor-pointer"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedMetrics.includes(option.key)}
                                            onChange={() => toggleMetric(option.key)}
                                            className="rounded border-border bg-surface text-accent focus:ring-accent/30"
                                        />
                                        {option.label}
                                    </label>
                                ))}
                            </div>

                            <div className="mt-4 flex flex-col sm:flex-row sm:items-end gap-3">
                                <div>
                                    <label className="text-[13px] text-fg-secondary">Format</label>
                                    <div className="input-box mb-0 mt-1">
                                        <select
                                            value={exportFormat}
                                            onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                                            className="w-full bg-transparent outline-none text-fg min-w-[120px]"
                                        >
                                            {EXPORT_FORMAT_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value} className="bg-surface">
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
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-accent-subtle text-accent border border-accent/30 hover:bg-accent-subtle disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-[42px]"
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

interface ReportSectionProps<T> {
    title: string
    description?: string
    value: T | undefined
    error: string | undefined
    onRetry: () => void
    render: (value: T) => ReactNode
}

/** BUG-05: wraps one reports section so a failed request shows a scoped, retryable error in place
 * of just that section instead of the whole page - `title`/`description` are repeated here rather
 * than read off the wrapped component so the heading stays put even when `render` never runs. */
function ReportSection<T>({ title, description, value, error, onRetry, render }: ReportSectionProps<T>): ReactNode {
    if (error) {
        return (
            <div className="card">
                <h3 className="text-sm font-medium text-fg">{title}</h3>
                {description && <p className="text-xs text-fg-muted mt-1">{description}</p>}
                <ErrorState message={error} onRetry={onRetry} />
            </div>
        )
    }
    if (value === undefined) return null
    return <>{render(value)}</>
}

const StatCardError: React.FC<{ label: string; message: string; onRetry: () => void }> = ({
    label,
    message,
    onRetry,
}) => (
    <div className="stat-card stat-card--neutral">
        <p className="stat-card__label">{label}</p>
        <p className="text-xs text-fg-muted mt-2 line-clamp-2">{message}</p>
        <button
            type="button"
            onClick={onRetry}
            className="mt-2 text-xs font-medium text-accent hover:underline"
        >
            Try again
        </button>
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
            <h3 className="text-sm font-medium text-fg">Income vs expense</h3>
            <p className="text-xs text-fg-muted mt-1">
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
            <h3 className="text-sm font-medium text-fg">Spending trends</h3>
            <p className="text-xs text-fg-muted mt-1">Month-over-month spending with change indicators</p>
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
        <span className="text-xs text-fg-muted">{label}</span>
        <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface/80 px-3 py-2 text-sm text-fg outline-none focus:border-accent/40"
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
        <span className="text-xs text-fg-muted">{label}</span>
        <input
            type="date"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface/80 px-3 py-2 text-sm text-fg outline-none focus:border-accent/40"
        />
    </label>
)

const BudgetAnalysisSection: React.FC<{ data: BudgetAnalysisReport }> = ({ data }) => (
    <div className="card">
        <h3 className="text-sm font-medium text-fg">Budget analysis</h3>
        <p className="text-xs text-fg-muted mt-1">
            {data.budgets.length} budget{data.budgets.length === 1 ? '' : 's'} in period ·{' '}
            {data.overBudgetCount} over · {data.underBudgetCount} under
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border-subtle bg-surface/50 p-3">
                <p className="text-xs text-fg-muted">Total budgeted</p>
                <p className="text-lg font-semibold text-violet-300 mt-1">{formatCurrency(data.totalBudgeted)}</p>
            </div>
            <div className="rounded-lg border border-border-subtle bg-surface/50 p-3">
                <p className="text-xs text-fg-muted">Total spent</p>
                <p className="text-lg font-semibold text-expense mt-1">{formatCurrency(data.totalSpent)}</p>
            </div>
        </div>
        {data.budgets.length === 0 ? (
            <p className="text-sm text-fg-muted mt-6 text-center py-6">No budgets overlap this period.</p>
        ) : (
            <ul className="mt-4 divide-y divide-slate-800">
                {data.budgets.map((budget) => (
                    <li key={budget.budgetId} className="py-2.5 flex items-center justify-between gap-3">
                        <div>
                            <p className="text-sm text-fg">{budget.name ?? budget.categoryName ?? 'Overall'}</p>
                            <p className="text-xs text-fg-muted">{budget.percentUsed.toFixed(0)}% used</p>
                        </div>
                        <p className="text-sm text-fg-secondary">
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
        <h3 className="text-sm font-medium text-fg">Spending analysis</h3>
        <p className="text-xs text-fg-muted mt-1">
            {data.transactionCount} transactions · avg {formatCurrency(data.averagePerTransaction)} per transaction
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-border-subtle bg-surface/50 p-3">
                <p className="text-xs text-fg-muted">Total spending</p>
                <p className="text-lg font-semibold text-expense mt-1">{formatCurrency(data.totalExpenses)}</p>
            </div>
            <div className="rounded-lg border border-border-subtle bg-surface/50 p-3">
                <p className="text-xs text-fg-muted">Top category</p>
                <p className="text-sm font-medium text-fg mt-1">
                    {data.topCategories[0]?.categoryName ?? '-'}
                </p>
                {data.topCategories[0] && (
                    <p className="text-xs text-fg-muted">{formatCurrency(data.topCategories[0].amount)}</p>
                )}
            </div>
            <div className="rounded-lg border border-border-subtle bg-surface/50 p-3">
                <p className="text-xs text-fg-muted">Top payment type</p>
                <p className="text-sm font-medium text-fg mt-1">
                    {data.topPaymentMethods[0]?.paymentMethod ?? '-'}
                </p>
                {data.topPaymentMethods[0] && (
                    <p className="text-xs text-fg-muted">{formatCurrency(data.topPaymentMethods[0].amount)}</p>
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
            <h3 className="text-sm font-medium text-fg">Crossover point</h3>
            <p className="text-xs text-fg-muted mt-1">
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
