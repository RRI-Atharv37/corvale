import React from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { BudgetOverviewItem } from '@features/dashboard/types'
import { formatCurrency } from '@lib/format'
import {
    axisTick,
    barChartTooltipProps,
    CHART_COLORS,
    chartMargin,
    formatChartCurrency,
} from './chartTheme'

interface BudgetOverviewChartProps {
    budgets: BudgetOverviewItem[]
    periodStart: string
    periodEnd: string
}

const BudgetOverviewChart: React.FC<BudgetOverviewChartProps> = ({
    budgets,
    periodStart,
    periodEnd,
}) => {
    const chartData = budgets.slice(0, 8).map((budget) => ({
        label: budget.name ?? budget.categoryName ?? 'Overall',
        spent: budget.spent,
        remaining: Math.max(0, budget.remaining),
        budgetAmount: budget.budgetAmount,
        isOverBudget: budget.isOverBudget,
    }))

    return (
        <div className="card">
            <h3 className="text-sm font-medium text-fg">Budget overview</h3>
            <p className="text-xs text-fg-muted mt-1">
                Active budgets for {periodStart} to {periodEnd}
            </p>
            {budgets.length === 0 ? (
                <p className="text-sm text-fg-muted mt-6 text-center py-8">No active budgets this month.</p>
            ) : (
                <>
                    <div className="h-64 mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={chartMargin} layout="vertical">
                                <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" horizontal={false} />
                                <XAxis
                                    type="number"
                                    tick={axisTick}
                                    axisLine={false}
                                    tickLine={false}
                                    tickFormatter={formatChartCurrency}
                                />
                                <YAxis
                                    type="category"
                                    dataKey="label"
                                    tick={axisTick}
                                    axisLine={false}
                                    tickLine={false}
                                    width={88}
                                />
                                <Tooltip
                                    {...barChartTooltipProps}
                                    formatter={(value: number, name: string) => [
                                        formatCurrency(value),
                                        name === 'spent' ? 'Spent' : 'Remaining',
                                    ]}
                                />
                                <Bar dataKey="spent" stackId="budget" fill={CHART_COLORS.expense} radius={[0, 0, 0, 0]} />
                                <Bar
                                    dataKey="remaining"
                                    stackId="budget"
                                    fill={CHART_COLORS.income}
                                    radius={[0, 4, 4, 0]}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <ul className="mt-4 divide-y divide-slate-800">
                        {budgets.map((budget) => (
                            <li key={budget.budgetId} className="py-2 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm text-fg truncate">
                                        {budget.name ?? budget.categoryName ?? 'Overall budget'}
                                    </p>
                                    <p className="text-xs text-fg-muted">
                                        {budget.percentUsed.toFixed(0)}% used
                                        {budget.isOverBudget ? ' · Over budget' : ''}
                                    </p>
                                </div>
                                <p className="text-sm text-fg-secondary shrink-0">
                                    {formatCurrency(budget.spent)} / {formatCurrency(budget.budgetAmount)}
                                </p>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    )
}

export default BudgetOverviewChart
