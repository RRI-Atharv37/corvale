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

import type { BalanceBreakdown, NetWorthPoint } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import {
    axisTick,
    CHART_COLORS,
    chartMargin,
    formatChartCurrency,
    formatPeriodLabel,
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

    const balanceItems = [
        { label: 'Net worth', value: currentBalances.netWorth, color: CHART_COLORS.net },
        { label: 'Spendable', value: currentBalances.spendable, color: CHART_COLORS.income },
        { label: 'Saver', value: currentBalances.saver, color: '#34d399' },
        ...(balanceSource === 'accounts'
            ? [
                  { label: 'Liquid', value: currentBalances.liquid, color: '#60a5fa' },
                  { label: 'Savings acct', value: currentBalances.savings, color: '#fbbf24' },
                  { label: 'Credit', value: currentBalances.credit, color: CHART_COLORS.expense },
              ]
            : []),
    ]

    return (
        <div className="card">
            <h3 className="text-sm font-medium text-slate-200">Net worth trend</h3>
            <p className="text-xs text-slate-500 mt-1">
                Net worth over time with current balance breakdown
            </p>

            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {balanceItems.map((item) => (
                    <div
                        key={item.label}
                        className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 min-w-0"
                    >
                        <p className="text-[10px] uppercase tracking-wide text-slate-500 truncate">
                            {item.label}
                        </p>
                        <p className="text-sm font-medium mt-1 truncate" style={{ color: item.color }}>
                            {formatCurrency(item.value)}
                        </p>
                    </div>
                ))}
            </div>

            <div className="h-56 mt-4">
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
                            contentStyle={{
                                backgroundColor: CHART_COLORS.tooltipBg,
                                border: `1px solid ${CHART_COLORS.tooltipBorder}`,
                                borderRadius: '0.5rem',
                                color: '#e2e8f0',
                                fontSize: '0.75rem',
                            }}
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
