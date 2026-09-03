import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import NetWorthChart from '../NetWorthChart'
import { formatCurrency } from '@lib/format'
import type { BalanceBreakdown, NetWorthPoint } from '@features/dashboard/types'

// X8 (Gate G3): NetWorthChart renders a bare Recharts <svg> with no accessible name or
// description. Acceptance spec: the chart exposes a role="img" text alternative summarizing net
// worth (and cumulative income/expense) per period.

const series: NetWorthPoint[] = [
    { period: '2026-01', netWorth: 5000, cumulativeIncome: 1000, cumulativeExpense: 400 },
    { period: '2026-02', netWorth: 5700, cumulativeIncome: 2200, cumulativeExpense: 900 },
]

const currentBalances: BalanceBreakdown = {
    liquid: 5000,
    savings: 1000,
    credit: 0,
    saver: 200,
    spendable: 4800,
    netWorth: 5700,
}

describe('NetWorthChart - accessible summary', () => {
    it('exposes the chart as an image with a text alternative naming net worth per period', () => {
        render(<NetWorthChart series={series} currentBalances={currentBalances} balanceSource="accounts" />)

        const chart = screen.getByRole('img', { name: /net worth trend/i })
        const accessibleName = chart.getAttribute('aria-label') ?? ''

        expect(accessibleName).toContain(formatCurrency(5000))
        expect(accessibleName).toContain(formatCurrency(5700))
    })
})
