import React from 'react'
import {
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'

import type { BalanceBreakdown, NetWorthPoint } from '@features/dashboard/types'
import { formatCurrency } from '@lib/format'
import {
    axisTick,
    CHART_COLORS,
    chartMargin,
    chartTooltipProps,
    formatChartCurrency,
    formatPeriodLabel,
    summarizeChartSeries,
    yAxisTick,
} from './chartTheme'

interface NetWorthChartProps {
    series: NetWorthPoint[]
    currentBalances: BalanceBreakdown
    balanceSource: 'accounts' | 'legacy'
}

const NetWorthChart: React.FC<NetWorthChartProps> = ({ series, currentBalances, balanceSource }) => {
    const chartData = series.map((point) => ({
        ...point,
        label: formatPeriodLabel(point.period, 'month'),
    }))

    const balanceItems: {
        label: string
        value: number
        pill: 'income' | 'expense' | 'accent' | 'neutral' | 'warning'
    }[] = [
        { label: 'Net worth', value: currentBalances.netWorth, pill: 'accent' },
        { label: 'Spendable', value: currentBalances.spendable, pill: 'income' },
        { label: 'Saver', value: currentBalances.saver, pill: 'income' },
        ...(balanceSource === 'accounts'
            ? [
                  { label: 'Liquid', value: currentBalances.liquid, pill: 'accent' as const },
                  { label: 'Savings acct', value: currentBalances.savings, pill: 'warning' as const },
                  { label: 'Credit', value: currentBalances.credit, pill: 'expense' as const },
              ]
            : []),
    ]

    const summary = `Net worth trend. ${summarizeChartSeries(chartData, [
        { key: 'netWorth', label: 'Net worth' },
        { key: 'cumulativeIncome', label: 'Cumulative income' },
        { key: 'cumulativeExpense', label: 'Cumulative expenses' },
    ])}`

    const pillClass = (pill: (typeof balanceItems)[number]['pill']) => {
        const map = {
            income: 'stat-pill--income',
            expense: 'stat-pill--expense',
            accent: 'stat-pill--accent',
            neutral: 'stat-pill--neutral',
            warning: 'stat-pill--warning',
        } as const
        return map[pill]
    }

    return (
        <div className="card">
            <h3 className="text-sm font-medium text-fg">Net worth trend</h3>
            <p className="text-xs text-fg-muted mt-1">
                Net worth over time with current balance breakdown
            </p>

            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {balanceItems.map((item) => (
                    <div key={item.label} className={`stat-pill ${pillClass(item.pill)}`}>
                        <p className="stat-pill__label truncate">{item.label}</p>
                        <p className="stat-pill__value">{formatCurrency(item.value)}</p>
                    </div>
                ))}
            </div>

            <div className="h-56 mt-4" role="img" aria-label={summary}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ ...chartMargin, bottom: 4 }}>
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
                            formatter={(value: number, name: string) => {
                                const labels: Record<string, string> = {
                                    netWorth: 'Net worth',
                                    cumulativeIncome: 'Cumulative income',
                                    cumulativeExpense: 'Cumulative expenses',
                                }
                                return [formatCurrency(value), labels[name] ?? name]
                            }}
                        />
                        <Legend
                            wrapperStyle={{
                                fontSize: '0.75rem',
                                color: CHART_COLORS.axis,
                                paddingTop: 12,
                            }}
                            formatter={(value) => {
                                const labels: Record<string, string> = {
                                    netWorth: 'Net worth',
                                    cumulativeIncome: 'Cumulative income',
                                    cumulativeExpense: 'Cumulative expenses',
                                }
                                return labels[value] ?? value
                            }}
                        />
                        <Line
                            type="monotone"
                            dataKey="netWorth"
                            stroke={CHART_COLORS.net}
                            strokeWidth={2}
                            dot={{ r: 3, fill: CHART_COLORS.net }}
                        />
                        <Line
                            type="monotone"
                            dataKey="cumulativeIncome"
                            stroke={CHART_COLORS.income}
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                            dot={false}
                        />
                        <Line
                            type="monotone"
                            dataKey="cumulativeExpense"
                            stroke={CHART_COLORS.expense}
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                            dot={false}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}

export default NetWorthChart
