import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import CashFlowChart from '../CashFlowChart'
import { formatCurrency } from '@lib/format'
import type { CashFlowPoint } from '@features/dashboard/types'

// X8 (Gate G3): CashFlowChart renders a bare Recharts <svg> with no accessible name or
// description. Acceptance spec: the chart exposes a role="img" text alternative summarizing
// income, spending, and net savings per period.

const data: CashFlowPoint[] = [
    { period: '2026-01', income: 1000, expense: 400, net: 600 },
    { period: '2026-02', income: 1200, expense: 500, net: 700 },
]

describe('CashFlowChart - accessible summary', () => {
    it('exposes the chart as an image with a text alternative naming income, spending, and net per period', () => {
        render(<CashFlowChart data={data} groupBy="month" />)

        const chart = screen.getByRole('img', { name: /cash flow/i })
        const accessibleName = chart.getAttribute('aria-label') ?? ''

        expect(accessibleName).toContain(formatCurrency(1000))
        expect(accessibleName).toContain(formatCurrency(400))
        expect(accessibleName).toContain(formatCurrency(600))
    })
})
