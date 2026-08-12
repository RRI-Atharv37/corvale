import React from 'react'
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'

import type { CashFlowPoint, DashboardGroupBy } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import {
    axisTick,
    CHART_COLORS,
    chartMargin,
    formatChartCurrency,
    formatPeriodLabel,
    yAxisTick,
} from './chartTheme'

interface CashFlowChartProps {
    data: CashFlowPoint[]
    groupBy: DashboardGroupBy
}

const CashFlowChart: React.FC<CashFlowChartProps> = ({ data, groupBy }) => {
    const chartData = data.map((point) => ({
        ...point,
        label: formatPeriodLabel(point.period, groupBy),
    }))

    return (
        <div className="card">
            <h3 className="text-sm font-medium text-slate-200">Cash flow</h3>
            <p className="text-xs text-slate-500 mt-1">Income, spending, and net savings by period</p>
            <div className="h-80 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={chartMargin}>
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
                                    income: 'Income',
                                    expense: 'Spending',
                                    net: 'Net savings',
                                }
                                return [formatCurrency(value), labels[name] ?? name]
                            }}
                            labelFormatter={(label) => String(label)}
                        />
                        <Legend
                            wrapperStyle={{ fontSize: '0.75rem', color: CHART_COLORS.axis }}
                            formatter={(value) => {
                                const labels: Record<string, string> = {
                                    income: 'Income',
                                    expense: 'Spending',
                                    net: 'Net savings',
                                }
                                return labels[value] ?? value
                            }}
                        />
                        <Bar dataKey="income" fill={CHART_COLORS.income} radius={[4, 4, 0, 0]} maxBarSize={28} />
                        <Bar dataKey="expense" fill={CHART_COLORS.expense} radius={[4, 4, 0, 0]} maxBarSize={28} />
                        <Line
                            type="monotone"
                            dataKey="net"
                            stroke={CHART_COLORS.net}
                            strokeWidth={2}
                            dot={{ r: 3, fill: CHART_COLORS.net }}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}

export default CashFlowChart
