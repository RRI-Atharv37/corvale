import React from 'react'
import {
    Cell,
    Legend,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
} from 'recharts'

import type { CategoryBreakdownItem } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import { CHART_CATEGORY_COLORS, CHART_COLORS, chartTooltipProps } from './chartTheme'

interface CategoryBreakdownChartProps {
    data: CategoryBreakdownItem[]
}

const CategoryBreakdownChart: React.FC<CategoryBreakdownChartProps> = ({ data }) => {
    const chartData = data.map((item, index) => ({
        name: item.categoryName,
        value: item.amount,
        color: item.color ?? CHART_CATEGORY_COLORS[index % CHART_CATEGORY_COLORS.length],
    }))

    if (chartData.length === 0) {
        return (
            <div className="card">
                <h3 className="text-sm font-medium text-fg">Category breakdown</h3>
                <p className="text-xs text-fg-muted mt-1">Spending by category for the selected period</p>
                <p className="text-sm text-fg-muted mt-8 text-center py-12">No expense data in this period.</p>
            </div>
        )
    }

    return (
        <div className="card">
            <h3 className="text-sm font-medium text-fg">Category breakdown</h3>
            <p className="text-xs text-fg-muted mt-1">Spending by category for the selected period</p>
            <div className="h-80 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={chartData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={56}
                            outerRadius={96}
                            paddingAngle={2}
                        >
                            {chartData.map((entry) => (
                                <Cell key={entry.name} fill={entry.color} stroke="#14121c" strokeWidth={2} />
                            ))}
                        </Pie>
                        <Tooltip
                            {...chartTooltipProps}
                            formatter={(value: number) => formatCurrency(value)}
                        />
                        <Legend
                            wrapperStyle={{ fontSize: '0.75rem', color: CHART_COLORS.axis }}
                            layout="vertical"
                            align="right"
                            verticalAlign="middle"
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}

export default CategoryBreakdownChart
