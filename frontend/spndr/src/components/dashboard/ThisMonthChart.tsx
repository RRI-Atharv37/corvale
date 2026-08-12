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

    return (
        <div className="card">
            <h3 className="text-sm font-medium text-slate-200">This month</h3>
            <p className="text-xs text-slate-500 mt-1">
                Daily activity from {periodStart} to {periodEnd}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
                    <p className="text-[10px] text-slate-500">Income</p>
                    <p className="text-sm font-medium text-cyan-300">{formatCurrency(totalIncome)}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
                    <p className="text-[10px] text-slate-500">Expenses</p>
                    <p className="text-sm font-medium text-rose-300">{formatCurrency(totalExpense)}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
                    <p className="text-[10px] text-slate-500">Net</p>
                    <p className={`text-sm font-medium ${net >= 0 ? 'text-violet-300' : 'text-rose-300'}`}>
                        {formatCurrency(net)}
                    </p>
                </div>
            </div>
            <div className="h-56 mt-4">
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
                            contentStyle={{
                                backgroundColor: CHART_COLORS.tooltipBg,
                                border: `1px solid ${CHART_COLORS.tooltipBorder}`,
                                borderRadius: '0.5rem',
                                color: '#e2e8f0',
                                fontSize: '0.75rem',
                            }}
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
