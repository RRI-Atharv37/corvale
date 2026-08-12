import React from 'react'
import {
    CartesianGrid,
    Line,
    LineChart,
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

interface IncomeOverTimeChartProps {
    data: CashFlowPoint[]
    groupBy: DashboardGroupBy
}

const IncomeOverTimeChart: React.FC<IncomeOverTimeChartProps> = ({ data, groupBy }) => {
    const chartData = data.map((point) => ({
        ...point,
        label: formatPeriodLabel(point.period, groupBy),
    }))

    return (
        <div className="card">
            <h3 className="text-sm font-medium text-slate-200">Income over time</h3>
            <p className="text-xs text-slate-500 mt-1">Posted income by period</p>
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
                            contentStyle={{
                                backgroundColor: CHART_COLORS.tooltipBg,
                                border: `1px solid ${CHART_COLORS.tooltipBorder}`,
                                borderRadius: '0.5rem',
                                color: '#e2e8f0',
                                fontSize: '0.75rem',
                            }}
                            formatter={(value: number) => [formatCurrency(value), 'Income']}
                            labelFormatter={(label) => String(label)}
                        />
                        <Line
                            type="monotone"
                            dataKey="income"
                            stroke={CHART_COLORS.income}
                            strokeWidth={2}
                            dot={{ r: 3, fill: CHART_COLORS.income }}
                            activeDot={{ r: 5 }}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}

export default IncomeOverTimeChart
