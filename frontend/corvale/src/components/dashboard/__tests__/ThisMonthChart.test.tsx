import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '../../../test/test-utils'
import ThisMonthChart from '../ThisMonthChart'
import { formatCurrency } from '../../../utils/format'
import type { CashFlowPoint } from '../../../types/api'

// X8 (Gate G3): ThisMonthChart renders a bare Recharts <svg> with no accessible name or
// description. Acceptance spec: the chart exposes a role="img" text alternative summarizing
// income and expense per period.

const data: CashFlowPoint[] = [
    { period: '2026-01-01', income: 100, expense: 40, net: 60 },
    { period: '2026-01-02', income: 0, expense: 20, net: -20 },
]

describe('ThisMonthChart - accessible summary', () => {
    it('exposes the chart as an image with a text alternative naming income/expense per period', () => {
        render(<ThisMonthChart data={data} groupBy="day" periodStart="2026-01-01" periodEnd="2026-01-31" />)

        const chart = screen.getByRole('img', { name: /this month/i })
        const accessibleName = chart.getAttribute('aria-label') ?? ''

        expect(accessibleName).toContain(formatCurrency(100))
        expect(accessibleName).toContain(formatCurrency(40))
        expect(accessibleName).toContain(formatCurrency(20))
    })
})
