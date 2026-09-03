import React from 'react'
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'

import type { CashFlowPoint, DashboardGroupBy } from '@lib/types/api'
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

interface ThisMonthChartProps {
    data: CashFlowPoint[]
    groupBy: DashboardGroupBy
    periodStart: string
    periodEnd: string
}

const ThisMonthChart: React.FC<ThisMonthChartProps> = ({ data, groupBy, periodStart, periodEnd }) => {
    const chartData = data.map((point) => ({
        ...point,
        label: formatPeriodLabel(point.period, groupBy),
    }))

    const totalIncome = data.reduce((sum, point) => sum + point.income, 0)
    const totalExpense = data.reduce((sum, point) => sum + point.expense, 0)
    const net = totalIncome - totalExpense

    const summary = `This month. ${summarizeChartSeries(chartData, [
        { key: 'income', label: 'Income' },
        { key: 'expense', label: 'Expenses' },
    ])}`

    return (
        <div className="card">
            <h3 className="text-sm font-medium text-fg">This month</h3>
            <p className="text-xs text-fg-muted mt-1">
                Daily activity from {periodStart} to {periodEnd}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="stat-pill stat-pill--income">
                    <p className="stat-pill__label">Income</p>
                    <p className="stat-pill__value">{formatCurrency(totalIncome)}</p>
                </div>
                <div className="stat-pill stat-pill--expense">
                    <p className="stat-pill__label">Expenses</p>
                    <p className="stat-pill__value">{formatCurrency(totalExpense)}</p>
                </div>
                <div className={`stat-pill ${net >= 0 ? 'stat-pill--net-positive' : 'stat-pill--net-negative'}`}>
                    <p className="stat-pill__label">Net</p>
                    <p className="stat-pill__value">{formatCurrency(net)}</p>
                </div>
            </div>
            <div className="h-56 mt-4" role="img" aria-label={summary}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={chartMargin}>
                        <defs>
                            <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.income} stopOpacity={0.35} />
                                <stop offset="95%" stopColor={CHART_COLORS.income} stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.expense} stopOpacity={0.35} />
                                <stop offset="95%" stopColor={CHART_COLORS.expense} stopOpacity={0} />
                            </linearGradient>
                        </defs>
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
                                name === 'income' ? 'Income' : 'Expenses',
                            ]}
                        />
                        <Area
                            type="monotone"
                            dataKey="income"
                            stroke={CHART_COLORS.income}
                            fill="url(#incomeGradient)"
                            strokeWidth={2}
                        />
                        <Area
                            type="monotone"
                            dataKey="expense"
                            stroke={CHART_COLORS.expense}
                            fill="url(#expenseGradient)"
                            strokeWidth={2}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}

export default ThisMonthChart
