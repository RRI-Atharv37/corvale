import React, { useMemo, useState } from 'react'
import { IoAlertCircle, IoArrowDown, IoArrowUp, IoSwapHorizontal } from 'react-icons/io5'
import {
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import StatCard from '../../components/ui/StatCard'
import { useWorkspace } from '../../hooks/useWorkspace'
import WorkspaceReadOnlyBanner from '../../components/workspaces/WorkspaceReadOnlyBanner'
import { useForecastData } from './hooks/useForecastData'
import type { ForecastAccount } from '../../types/api'
import { formatCurrency, formatDisplayDate } from '../../utils/format'
import {
    axisTick,
    CHART_COLORS,
    chartMargin,
    chartTooltipProps,
    formatChartCurrency,
    yAxisTick,
} from '../../components/dashboard/chartTheme'

const DAYS_OPTIONS = [30, 60, 90] as const

const changeIcon = (type: ForecastAccount['projectedChanges'][number]['type']): React.ReactNode => {
    switch (type) {
        case 'recurring':
            return <IoSwapHorizontal size={14} />
        case 'goal':
            return <IoArrowUp size={14} />
        default:
            return <IoArrowDown size={14} />
    }
}

const changeLabel: Record<ForecastAccount['projectedChanges'][number]['type'], string> = {
    recurring: 'Recurring',
    goal: 'Goal contribution',
    discretionary: 'Discretionary spend',
}

interface AccountForecastCardProps {
    account: ForecastAccount
}

const AccountForecastCard: React.FC<AccountForecastCardProps> = ({ account }) => {
    const chartData = useMemo(() => {
        const sorted = [...account.projectedChanges].sort((a, b) => a.date.localeCompare(b.date))
        let balance = account.startingBalance
        const points = [{ date: 'Today', balance }]
        for (const change of sorted) {
            balance = Math.round((balance + change.amount + Number.EPSILON) * 100) / 100
            points.push({ date: formatDisplayDate(change.date), balance })
        }
        if (points[points.length - 1]?.balance !== account.projectedEndingBalance) {
            points.push({ date: 'End', balance: account.projectedEndingBalance })
        }
        return points
    }, [account])

    return (
        <div className="card space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <p className="text-sm font-medium text-fg">{account.accountName}</p>
                    <p className="text-xs text-fg-muted mt-0.5">{account.currency}</p>
                </div>
                {account.lowBalanceWarnings.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-expense/10 border border-negative/20 px-2 py-0.5 text-[11px] font-medium text-expense">
                        <IoAlertCircle size={12} />
                        {account.lowBalanceWarnings.length} low-balance warning
                        {account.lowBalanceWarnings.length === 1 ? '' : 's'}
                    </span>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3">
                <StatCard
                    label="Starting balance"
                    value={formatCurrency(account.startingBalance, account.currency)}
                    accent="neutral"
                />
                <StatCard
                    label="Projected ending balance"
                    value={formatCurrency(account.projectedEndingBalance, account.currency)}
                    accent={account.projectedEndingBalance < 0 ? 'expense' : 'accent'}
                />
            </div>

            {chartData.length > 1 && (
                <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={chartMargin}>
                            <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} />
                            <YAxis
                                tick={yAxisTick}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={formatChartCurrency}
                                width={52}
                            />
                            <Tooltip
                                {...chartTooltipProps}
                                formatter={(value: number) => formatCurrency(value, account.currency)}
                            />
                            <Line
                                type="stepAfter"
                                dataKey="balance"
                                stroke={CHART_COLORS.net}
                                strokeWidth={2}
                                dot={{ r: 3, fill: CHART_COLORS.net }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}

            {account.projectedChanges.length > 0 && (
                <div className="space-y-1.5">
                    <p className="text-[13px] text-fg-secondary">Upcoming changes</p>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                        {[...account.projectedChanges]
                            .sort((a, b) => a.date.localeCompare(b.date))
                            .map((change, index) => (
                                <div
                                    key={`${change.refId ?? change.type}-${change.date}-${index}`}
                                    className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2"
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-fg-muted shrink-0">{changeIcon(change.type)}</span>
                                        <div className="min-w-0">
                                            <p className="text-xs text-fg truncate">{change.label}</p>
                                            <p className="text-[11px] text-fg-muted">
                                                {changeLabel[change.type]} · {formatDisplayDate(change.date)}
                                            </p>
                                        </div>
                                    </div>
                                    <p
                                        className={`text-xs font-medium shrink-0 ${
                                            change.amount >= 0 ? 'text-income' : 'text-expense'
                                        }`}
                                    >
                                        {change.amount >= 0 ? '+' : ''}
                                        {formatCurrency(change.amount, account.currency)}
                                    </p>
                                </div>
                            ))}
                    </div>
                </div>
            )}
        </div>
    )
}

const Forecast: React.FC = () => {
    const { activeWorkspace, isPersonal } = useWorkspace()
    const [days, setDays] = useState<(typeof DAYS_OPTIONS)[number]>(30)
    const [accountId, setAccountId] = useState<string>('')

    const { accounts, forecast, loading, error, refetch } = useForecastData(days, accountId)

    return (
        <div>
            <PageHeader
                title="Cash flow forecast"
                description={
                    isPersonal
                        ? 'Projected balances based on recurring bills, goal contributions, and average spending'
                        : `Forecast for ${activeWorkspace?.name ?? 'workspace'}`
                }
            />

            <WorkspaceReadOnlyBanner />

            <div className="flex flex-wrap items-center gap-3 mb-6">
                <div className="flex gap-2">
                    {DAYS_OPTIONS.map((option) => (
                        <button
                            key={option}
                            type="button"
                            onClick={() => setDays(option)}
                            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                days === option
                                    ? 'bg-accent-subtle text-accent border border-accent/30'
                                    : 'text-fg-muted border border-border-subtle hover:border-border'
                            }`}
                        >
                            {option} days
                        </button>
                    ))}
                </div>

                <div className="input-box mb-0 w-full sm:w-56">
                    <select
                        value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}
                        className="w-full bg-transparent outline-none text-fg"
                    >
                        <option value="" className="bg-surface">
                            All accounts
                        </option>
                        {(accounts ?? []).map((account) => (
                            <option key={account._id} value={account._id} className="bg-surface">
                                {account.name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <AsyncContent
                loading={loading}
                error={error}
                data={forecast}
                isEmpty={(data) => data.accounts.length === 0}
                loadingMessage="Projecting your cash flow..."
                emptyTitle="No accounts to forecast"
                emptyDescription="Create an account to see a projected balance."
                onRetry={refetch}
            >
                {(data) => (
                    <div className="space-y-4">
                        {data.accounts.map((account) => (
                            <AccountForecastCard key={account.accountId} account={account} />
                        ))}
                    </div>
                )}
            </AsyncContent>
        </div>
    )
}

export default Forecast
