import type { CSSProperties } from 'react'
import type { XAxisProps, YAxisProps } from 'recharts'
import { getCurrencySymbol } from '../../utils/format'

export const CHART_COLORS = {
    income: '#4ade80',
    expense: '#fb7185',
    net: '#a855f7',
    grid: '#3d3654',
    axis: '#9a92b0',
    tooltipBg: '#2e2a40',
    tooltipBorder: '#3d3654',
    tooltipLabel: '#c8c0dc',
    tooltipValue: '#f8f6ff',
} as const

export const CHART_CATEGORY_COLORS = [
    '#9333ea',
    '#c084fc',
    '#a855f7',
    '#4ade80',
    '#fb7185',
    '#fbbf24',
    '#7c3aed',
    '#d8b4fe',
    '#34d399',
    '#fb923c',
]

export const chartMargin = { top: 8, right: 12, left: 0, bottom: 0 }

export const chartTooltipContentStyle: CSSProperties = {
    backgroundColor: CHART_COLORS.tooltipBg,
    border: `1px solid ${CHART_COLORS.tooltipBorder}`,
    borderRadius: '0.75rem',
    color: CHART_COLORS.tooltipValue,
    fontSize: '0.75rem',
}

export const chartTooltipLabelStyle: CSSProperties = {
    color: CHART_COLORS.tooltipLabel,
    fontWeight: 500,
    marginBottom: 4,
}

export const chartTooltipItemStyle: CSSProperties = {
    color: CHART_COLORS.tooltipValue,
}

/** Tooltip props for bar charts - hides the default hover highlight band */
export const barChartTooltipProps = {
    contentStyle: chartTooltipContentStyle,
    labelStyle: chartTooltipLabelStyle,
    itemStyle: chartTooltipItemStyle,
    cursor: false as const,
}

export const chartTooltipProps = {
    contentStyle: chartTooltipContentStyle,
    labelStyle: chartTooltipLabelStyle,
    itemStyle: chartTooltipItemStyle,
}

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
    const symbol = getCurrencySymbol()
    if (Math.abs(value) >= 1000) {
        return `${symbol}${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
    }
    return `${symbol}${value}`
}
