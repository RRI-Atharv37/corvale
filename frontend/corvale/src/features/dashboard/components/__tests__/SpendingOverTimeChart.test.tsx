import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import SpendingOverTimeChart from '../SpendingOverTimeChart'
import { formatCurrency } from '@lib/format'
import type { CashFlowPoint } from '@features/dashboard/types'

// X8 (Gate G3): SpendingOverTimeChart renders a bare Recharts <svg> with no accessible name or
// description. Acceptance spec: the chart exposes a role="img" text alternative summarizing
// spending per period.

const data: CashFlowPoint[] = [
    { period: '2026-01', income: 1000, expense: 400, net: 600 },
    { period: '2026-02', income: 1200, expense: 500, net: 700 },
]

describe('SpendingOverTimeChart - accessible summary', () => {
    it('exposes the chart as an image with a text alternative naming spending per period', () => {
        render(<SpendingOverTimeChart data={data} groupBy="month" />)

        const chart = screen.getByRole('img', { name: /spending over time/i })
        const accessibleName = chart.getAttribute('aria-label') ?? ''

        expect(accessibleName).toContain(formatCurrency(400))
        expect(accessibleName).toContain(formatCurrency(500))
    })
})
