import { describe, it, expect } from 'vitest'
import { summarizeChartSeries } from '../chartTheme'
import { formatCurrency } from '../../../utils/format'

// X8 (Gate G3): shared helper behind the aria-label text alternative on every time-series
// dashboard chart (NetWorthChart, SpendingOverTimeChart, ThisMonthChart, IncomeOverTimeChart,
// CashFlowChart). Acceptance spec for the helper's two modes: per-point enumeration for a normal
// period, and a collapsed per-series total once the point count would make the label unusably long.

describe('summarizeChartSeries', () => {
    it('returns a no-data message for an empty series', () => {
        expect(summarizeChartSeries([], [{ key: 'income', label: 'Income' }])).toBe('No data for this period.')
    })

    it('enumerates each point and series for a normal-length period', () => {
        const data = [
            { label: 'Jan', income: 1000, expense: 400 },
            { label: 'Feb', income: 1200, expense: 500 },
        ]
        const summary = summarizeChartSeries(data, [
            { key: 'income', label: 'Income' },
            { key: 'expense', label: 'Expenses' },
        ])

        expect(summary).toContain(`Jan: Income ${formatCurrency(1000)}, Expenses ${formatCurrency(400)}`)
        expect(summary).toContain(`Feb: Income ${formatCurrency(1200)}, Expenses ${formatCurrency(500)}`)
    })

    it('collapses to a per-series total once the series has more than 24 points', () => {
        const data = Array.from({ length: 30 }, (_, i) => ({ label: `Day ${i + 1}`, expense: 10 }))
        const summary = summarizeChartSeries(data, [{ key: 'expense', label: 'Spending' }])

        expect(summary).toContain('30 periods from Day 1 to Day 30')
        expect(summary).toContain(`Spending total ${formatCurrency(300)}`)
        expect(summary).not.toContain('Day 2:')
    })
})
