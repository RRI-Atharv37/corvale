import React, { useCallback, useMemo, useState } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useUser } from '../../hooks/useUser'
import type {
    ApiResponse,
    BudgetOverviewResponse,
    DashboardCashFlowResponse,
    DashboardCategoryBreakdownResponse,
    DashboardGroupBy,
    DashboardPeriodPreset,
    DashboardSummary,
    NetWorthTrendResponse,
    RecurringRule,
    Transaction,
} from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { Link } from 'react-router-dom'
import { formatCurrency, getCurrentMonthYear, toDateInputValue } from '../../utils/format'
import IncomeOverTimeChart from '../../components/dashboard/IncomeOverTimeChart'
import SpendingOverTimeChart from '../../components/dashboard/SpendingOverTimeChart'
import CashFlowChart from '../../components/dashboard/CashFlowChart'
import CategoryBreakdownChart from '../../components/dashboard/CategoryBreakdownChart'
import NetWorthChart from '../../components/dashboard/NetWorthChart'
import BudgetOverviewChart from '../../components/dashboard/BudgetOverviewChart'
import DashboardCalendarCard from '../../components/dashboard/DashboardCalendarCard'
import ThisMonthChart from '../../components/dashboard/ThisMonthChart'

interface DashboardData {
    summary: DashboardSummary
    cashFlow: DashboardCashFlowResponse
    categoryBreakdown: DashboardCategoryBreakdownResponse
    netWorthTrend: NetWorthTrendResponse
    budgetOverview: BudgetOverviewResponse
    thisMonthCashFlow: DashboardCashFlowResponse
    recurringRules: RecurringRule[]
    recurringDrafts: Transaction[]
}

const PERIOD_PRESETS: { value: DashboardPeriodPreset; label: string }[] = [
    { value: '1m', label: 'This month' },
    { value: '3m', label: 'Last 3 months' },
    { value: '6m', label: 'Last 6 months' },
    { value: '12m', label: 'Last 12 months' },
    { value: 'ytd', label: 'Year to date' },
]

const resolvePeriodRange = (preset: DashboardPeriodPreset): { startDate: string; endDate: string } => {
    const endDate = toDateInputValue(new Date())
    const end = new Date(`${endDate}T12:00:00`)

    if (preset === 'ytd') {
        const startDate = `${end.getFullYear()}-01-01`
        return { startDate, endDate }
    }

    if (preset === '1m') {
        const startDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-01`
        return { startDate, endDate }
    }

    const monthsBack = preset === '3m' ? 2 : preset === '12m' ? 11 : 5
    const start = new Date(end)
    start.setMonth(start.getMonth() - monthsBack)
    start.setDate(1)

    return { startDate: toDateInputValue(start), endDate }
}

const resolveGroupBy = (preset: DashboardPeriodPreset): DashboardGroupBy =>
    preset === '1m' ? 'day' : 'month'

const resolveThisMonthRange = (): { startDate: string; endDate: string } => {
    const { year, month } = getCurrentMonthYear()
    const endDate = toDateInputValue(new Date())
    return { startDate: `${year}-${String(month).padStart(2, '0')}-01`, endDate }
}

const Home = () => {
    const { user } = useUser()
    const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>('6m')

    const periodQuery = useMemo(() => {
        const { startDate, endDate } = resolvePeriodRange(periodPreset)
        const groupBy = resolveGroupBy(periodPreset)
        return { startDate, endDate, groupBy }
    }, [periodPreset])

    const thisMonthQuery = useMemo(() => {
        const { startDate, endDate } = resolveThisMonthRange()
        return { startDate, endDate, groupBy: 'day' as DashboardGroupBy }
    }, [])

    const fetchDashboard = useCallback(async (): Promise<DashboardData> => {
        const params = periodQuery

        try {
            const [
                summaryRes,
                cashFlowRes,
                categoryRes,
                netWorthRes,
                budgetRes,
                thisMonthRes,
                rulesRes,
                draftsRes,
            ] = await Promise.all([
                axiosInstance.get<ApiResponse<DashboardSummary>>(API_PATHS.DASHBOARD.SUMMARY, {
                    params,
                }),
                axiosInstance.get<ApiResponse<DashboardCashFlowResponse>>(API_PATHS.DASHBOARD.CASH_FLOW, {
                    params,
                }),
                axiosInstance.get<ApiResponse<DashboardCategoryBreakdownResponse>>(
                    API_PATHS.DASHBOARD.CATEGORY_BREAKDOWN,
                    { params: { startDate: params.startDate, endDate: params.endDate, type: 'expense' } }
                ),
                axiosInstance.get<ApiResponse<NetWorthTrendResponse>>(API_PATHS.DASHBOARD.NET_WORTH_TREND, {
                    params,
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

            return {
                summary: unwrapApiData(summaryRes),
                cashFlow: unwrapApiData(cashFlowRes),
                categoryBreakdown: unwrapApiData(categoryRes),
                netWorthTrend: unwrapApiData(netWorthRes),
                budgetOverview: unwrapApiData(budgetRes),
                thisMonthCashFlow: unwrapApiData(thisMonthRes),
                recurringRules: unwrapApiData(rulesRes),
                recurringDrafts: unwrapApiData(draftsRes),
            }
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load dashboard analytics'))
        }
    }, [periodQuery, thisMonthQuery])

    const { data, loading, error, refetch } = useAsyncData(fetchDashboard, [fetchDashboard])

    const periodLabel = PERIOD_PRESETS.find((preset) => preset.value === periodPreset)?.label ?? 'Selected period'

    return (
        <div>
            <PageHeader
                title="Dashboard"
                description={`Overview for ${user?.fullName ?? 'your account'}`}
            />

            <div className="flex flex-wrap items-center gap-2 mb-6">
                {PERIOD_PRESETS.map((preset) => (
                    <button
                        key={preset.value}
                        type="button"
                        onClick={() => setPeriodPreset(preset.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            periodPreset === preset.value
                                ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                                : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                        }`}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>

            <AsyncContent
                loading={loading}
                error={error}
                data={data}
                isEmpty={() => false}
                loadingMessage="Loading dashboard..."
                emptyTitle="No data yet"
                emptyDescription="Start by adding transactions."
                onRetry={refetch}
            >
                {({
                    summary,
                    cashFlow,
                    categoryBreakdown,
                    netWorthTrend,
                    budgetOverview,
                    thisMonthCashFlow,
                    recurringRules,
                    recurringDrafts,
                }) => {
                    const spendableSubtitle =
                        summary.balanceSource === 'accounts'
                            ? `From checking & cash · Saver: ${formatCurrency(summary.saverBalance)}`
                            : `Saver: ${formatCurrency(summary.saverBalance)}`

                    const netWorthSubtitle =
                        summary.balanceSource === 'accounts'
                            ? `Across ${summary.accountCount} account${summary.accountCount === 1 ? '' : 's'}`
                            : 'From posted income and expenses'

                    const netSavingsAccent =
                        summary.netSavings >= 0 ? ('cyan' as const) : ('rose' as const)

                    return (
                        <>
                            <p className="text-xs text-slate-500 mb-4">
                                Period totals for {periodLabel.toLowerCase()} ({summary.periodStart} to{' '}
                                {summary.periodEnd}). Net worth reflects current account balances.
                            </p>

                            <div
                                className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${
                                    summary.balanceSource === 'accounts'
                                        ? 'lg:grid-cols-3 xl:grid-cols-4'
                                        : 'lg:grid-cols-3 xl:grid-cols-4'
                                }`}
                            >
                                <StatCard
                                    label="Total Income"
                                    value={formatCurrency(summary.totalIncome)}
                                    accent="cyan"
                                    subtitle={periodLabel}
                                />
                                <StatCard
                                    label="Total Expenses"
                                    value={formatCurrency(summary.totalExpenses)}
                                    accent="rose"
                                    subtitle={periodLabel}
                                />
                                <StatCard
                                    label="Avg / Month"
                                    value={formatCurrency(summary.averageExpensePerMonth)}
                                    accent="violet"
                                    subtitle={`Income ${formatCurrency(summary.averageIncomePerMonth)} · ${summary.monthCount} mo`}
                                />
                                <StatCard
                                    label="Avg / Transaction"
                                    value={formatCurrency(summary.averageExpensePerTransaction)}
                                    accent="violet"
                                    subtitle={`${summary.expenseTransactionCount} expenses · income ${formatCurrency(summary.averageIncomePerTransaction)}`}
                                />
                            </div>

                            <div
                                className={`mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 ${
                                    summary.balanceSource === 'accounts'
                                        ? 'lg:grid-cols-3 xl:grid-cols-6'
                                        : 'lg:grid-cols-3 xl:grid-cols-5'
                                }`}
                            >
                                <StatCard
                                    label="Net Worth"
                                    value={formatCurrency(summary.netWorth)}
                                    accent="slate"
                                    subtitle={netWorthSubtitle}
                                />
                                <StatCard
                                    label="Net Savings"
                                    value={formatCurrency(summary.netSavings)}
                                    accent={netSavingsAccent}
                                    subtitle={`Income − expenses · ${periodLabel.toLowerCase()}`}
                                />
                                <StatCard
                                    label="Spendable Balance"
                                    value={formatCurrency(summary.spendableBalance)}
                                    accent="violet"
                                    subtitle={spendableSubtitle}
                                />
                                {summary.balanceSource === 'accounts' && (
                                    <StatCard
                                        label="In Accounts"
                                        value={formatCurrency(summary.totalAccountBalance)}
                                        accent="cyan"
                                        subtitle="Sum of all account balances"
                                    />
                                )}
                            </div>

                            <div className="mt-8 grid grid-cols-1 xl:grid-cols-2 gap-6">
                                <ThisMonthChart
                                    data={thisMonthCashFlow.series}
                                    groupBy={thisMonthCashFlow.groupBy}
                                    periodStart={thisMonthCashFlow.periodStart}
                                    periodEnd={thisMonthCashFlow.periodEnd}
                                />
                                <NetWorthChart
                                    series={netWorthTrend.series}
                                    currentBalances={netWorthTrend.currentBalances}
                                    balanceSource={netWorthTrend.balanceSource}
                                />
                            </div>

                            <div className="mt-6">
                                <CashFlowChart data={cashFlow.series} groupBy={cashFlow.groupBy} />
                            </div>

                            <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
                                <IncomeOverTimeChart data={cashFlow.series} groupBy={cashFlow.groupBy} />
                                <SpendingOverTimeChart data={cashFlow.series} groupBy={cashFlow.groupBy} />
                            </div>

                            <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
                                <BudgetOverviewChart
                                    budgets={budgetOverview.budgets}
                                    periodStart={budgetOverview.periodStart}
                                    periodEnd={budgetOverview.periodEnd}
                                />
                                <DashboardCalendarCard rules={recurringRules} drafts={recurringDrafts} />
                            </div>

                            <div className="mt-6">
                                <CategoryBreakdownChart data={categoryBreakdown.breakdown} />
                            </div>
                        </>
                    )
                }}
            </AsyncContent>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <QuickLink to="/transactions" title="Transactions" description="View and manage income & expenses" />
                <QuickLink to="/budgets" title="Budgets" description="Set limits and track spending progress" />
                <QuickLink to="/reports" title="Reports" description="Advanced analytics and custom reports" />
                <QuickLink to="/savings-goals" title="Savings Goals" description="Track progress toward your targets" />
                <QuickLink to="/recurring" title="Recurring" description="Manage bills, drafts, and upcoming due dates" />
                <QuickLink to="/transactions?type=income" title="Income" description="Filter to income entries" />
                <QuickLink to="/accounts" title="Accounts" description="View and manage your accounts" />
            </div>
        </div>
    )
}

interface StatCardProps {
    label: string
    value: string
    subtitle?: string
    accent: 'cyan' | 'rose' | 'violet' | 'slate'
}

const accentClasses: Record<StatCardProps['accent'], string> = {
    cyan: 'border-cyan-500/20 bg-cyan-500/5',
    rose: 'border-rose-500/20 bg-rose-500/5',
    violet: 'border-violet-500/20 bg-violet-500/5',
    slate: 'border-slate-700 bg-slate-900/40',
}

const StatCard: React.FC<StatCardProps> = ({ label, value, subtitle, accent }) => (
    <div className={`card ${accentClasses[accent]}`}>
        <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-semibold text-slate-100 mt-2">{value}</p>
        {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
    </div>
)

interface QuickLinkProps {
    to: string
    title: string
    description: string
}

const QuickLink: React.FC<QuickLinkProps> = ({ to, title, description }) => (
    <Link
        to={to}
        className="card hover:border-cyan-500/30 transition-colors group"
    >
        <p className="text-sm font-medium text-slate-200 group-hover:text-cyan-300">{title}</p>
        <p className="text-xs text-slate-500 mt-1">{description}</p>
    </Link>
)

export default Home
