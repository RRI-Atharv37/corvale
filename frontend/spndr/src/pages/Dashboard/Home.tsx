import React, { useCallback, useMemo, useState } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useUser } from '../../hooks/useUser'
import type { ApiResponse, DashboardPeriodPreset, DashboardSummary } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { Link } from 'react-router-dom'
import { formatCurrency, toDateInputValue } from '../../utils/format'

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

const Home = () => {
    const { user } = useUser()
    const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>('6m')

    const periodQuery = useMemo(() => resolvePeriodRange(periodPreset), [periodPreset])

    const fetchSummary = useCallback(async (): Promise<DashboardSummary> => {
        try {
            const summaryRes = await axiosInstance.get<ApiResponse<DashboardSummary>>(
                API_PATHS.DASHBOARD.SUMMARY,
                { params: periodQuery }
            )
            return unwrapApiData(summaryRes)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load dashboard'))
        }
    }, [periodQuery])

    const { data: summary, loading, error, refetch } = useAsyncData(fetchSummary, [fetchSummary])

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
                data={summary}
                isEmpty={() => false}
                loadingMessage="Loading dashboard..."
                emptyTitle="No data yet"
                emptyDescription="Start by adding transactions."
                onRetry={refetch}
            >
                {(summary) => {
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
                                        ? 'lg:grid-cols-3 xl:grid-cols-3'
                                        : 'lg:grid-cols-3 xl:grid-cols-3'
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
