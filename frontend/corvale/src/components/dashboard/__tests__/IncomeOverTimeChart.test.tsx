import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '../../../test/test-utils'
import IncomeOverTimeChart from '../IncomeOverTimeChart'
import { formatCurrency } from '../../../utils/format'
import type { CashFlowPoint } from '../../../types/api'

// X8 (Gate G3): IncomeOverTimeChart renders a bare Recharts <svg> with no accessible name or
// description. Acceptance spec: the chart exposes a role="img" text alternative summarizing income
// per period, matching the pattern already fixed on CategoryBreakdownChart.

const data: CashFlowPoint[] = [
    { period: '2026-01', income: 1000, expense: 400, net: 600 },
    { period: '2026-02', income: 1200, expense: 500, net: 700 },
]

describe('IncomeOverTimeChart - accessible summary', () => {
    it('exposes the chart as an image with a text alternative naming income per period', () => {
        render(<IncomeOverTimeChart data={data} groupBy="month" />)

        const chart = screen.getByRole('img', { name: /income over time/i })
        const accessibleName = chart.getAttribute('aria-label') ?? ''

        expect(accessibleName).toContain(formatCurrency(1000))
        expect(accessibleName).toContain(formatCurrency(1200))
    })
})
