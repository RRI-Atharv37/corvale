import React, { useMemo, useState } from 'react'
import PageHeader from '@ui/PageHeader'
import AsyncContent from '@ui/AsyncContent'
import { useUser } from '@/app/providers/useUser'
import type { DashboardPeriodPreset } from '@lib/types/api'
import { useDashboardSummaryData } from './hooks/useDashboardSummaryData'
import { Link } from 'react-router-dom'
import { formatCurrency, toDateInputValue } from '@lib/format'
import StatCard from '@ui/StatCard'
import QuickAddDropdown from '@features/transactions/components/QuickAddDropdown'
import QuickTransactionModal from './components/QuickTransactionModal'
import { useWorkspace } from '@/app/providers/useWorkspace'

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
    const { canEdit } = useWorkspace()
    const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>('6m')
    const [quickEntryType, setQuickEntryType] = useState<'income' | 'expense' | null>(null)

    const periodQuery = useMemo(() => resolvePeriodRange(periodPreset), [periodPreset])

    const { data: summary, loading, error, refetch } = useDashboardSummaryData(periodQuery)

    const periodLabel = PERIOD_PRESETS.find((preset) => preset.value === periodPreset)?.label ?? 'Selected period'

    return (
        <div>
            <PageHeader
                title="Dashboard"
                description={`Overview for ${user?.fullName ?? 'your account'}`}
                actions={<QuickAddDropdown onApplied={() => void refetch()} />}
            />

            <div className="flex flex-wrap items-center gap-2 mb-6">
                {PERIOD_PRESETS.map((preset) => (
                    <button
                        key={preset.value}
                        type="button"
                        onClick={() => setPeriodPreset(preset.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            periodPreset === preset.value
                                ? 'border-accent/40 bg-accent-subtle text-accent'
                                : 'border-border bg-surface/40 text-fg-muted hover:border-border hover:text-fg'
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
                        summary.netSavings >= 0 ? ('accent' as const) : ('expense' as const)

                    return (
                        <>
                            <p className="text-xs text-fg-muted mb-4">
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
                                    accent="income"
                                    subtitle={periodLabel}
                                    onAdd={canEdit ? () => setQuickEntryType('income') : undefined}
                                    addLabel="Add income"
                                />
                                <StatCard
                                    label="Total Expenses"
                                    value={formatCurrency(summary.totalExpenses)}
                                    accent="expense"
                                    subtitle={periodLabel}
                                    onAdd={canEdit ? () => setQuickEntryType('expense') : undefined}
                                    addLabel="Add expense"
                                />
                                <StatCard
                                    label="Net Worth"
                                    value={formatCurrency(summary.netWorth)}
                                    accent="neutral"
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
                                    accent="accent"
                                    subtitle={spendableSubtitle}
                                />
                                {summary.balanceSource === 'accounts' && (
                                    <StatCard
                                        label="In Accounts"
                                        value={formatCurrency(summary.totalAccountBalance)}
                                        accent="income"
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
                <QuickLink to="/reports" title="Reports & Analytics" description="Charts, trends, and custom reports" />
                <QuickLink to="/savings-goals" title="Savings Goals" description="Track progress toward your targets" />
                <QuickLink to="/recurring" title="Recurring" description="Manage bills, drafts, and upcoming due dates" />
                <QuickLink to="/transactions?type=income" title="Income" description="Filter to income entries" />
                <QuickLink to="/accounts" title="Accounts" description="View and manage your accounts" />
            </div>

            {quickEntryType && (
                <QuickTransactionModal
                    type={quickEntryType}
                    open={quickEntryType !== null}
                    onClose={() => setQuickEntryType(null)}
                    onCreated={() => void refetch()}
                />
            )}
        </div>
    )
}

interface QuickLinkProps {
    to: string
    title: string
    description: string
}

const QuickLink: React.FC<QuickLinkProps> = ({ to, title, description }) => (
    <Link
        to={to}
        className="card hover:border-accent/30 transition-colors group"
    >
        <p className="text-sm font-medium text-fg group-hover:text-accent">{title}</p>
        <p className="text-xs text-fg-muted mt-1">{description}</p>
    </Link>
)

export default Home
