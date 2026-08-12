import type { XAxisProps, YAxisProps } from 'recharts'

export const CHART_COLORS = {
    income: '#22d3ee',
    expense: '#fb7185',
    net: '#a78bfa',
    grid: '#334155',
    axis: '#94a3b8',
    tooltipBg: '#1e293b',
    tooltipBorder: '#334155',
} as const

export const CHART_CATEGORY_COLORS = [
    '#22d3ee',
    '#fb7185',
    '#a78bfa',
    '#34d399',
    '#fbbf24',
    '#f472b6',
    '#60a5fa',
    '#f97316',
    '#c084fc',
    '#4ade80',
]

export const chartMargin = { top: 8, right: 12, left: 0, bottom: 0 }

export const axisTick: XAxisProps['tick'] = { fill: CHART_COLORS.axis, fontSize: 11 }
export const yAxisTick: YAxisProps['tick'] = { fill: CHART_COLORS.axis, fontSize: 11 }

export const formatPeriodLabel = (period: string, groupBy: 'day' | 'week' | 'month'): string => {
    if (groupBy === 'month') {
        const [year, month] = period.split('-')
        const date = new Date(Number(year), Number(month) - 1, 1)
        return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    }

    if (groupBy === 'week') {
        return period.replace('-W', ' W')
    }

    const date = new Date(`${period}T12:00:00`)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const formatChartCurrency = (value: number): string => {
    if (Math.abs(value) >= 1000) {
        return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
    }
    return `$${value}`
}
