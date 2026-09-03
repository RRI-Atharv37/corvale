import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import CategoryBreakdownChart from '../CategoryBreakdownChart'
import { formatCurrency } from '@lib/format'
import type { CategoryBreakdownItem } from '@features/dashboard/types'

// X8 (Gate G3): CategoryBreakdownChart renders a bare Recharts <svg> pie with no accessible name
// or description - a screen-reader user gets an unlabeled graphic and none of the underlying
// numbers the sighted legend shows. Acceptance spec: the chart exposes an accessible summary
// (role="img" with an aria-label, the standard pattern for a non-interactive data graphic) that
// verbalizes every category and its formatted amount, so the same information sighted users get
// from the legend is available to assistive tech.

const sampleData: CategoryBreakdownItem[] = [
    { categoryId: 'c1', categoryName: 'Food', amount: 150 },
    { categoryId: 'c2', categoryName: 'Transport', amount: 42.5 },
]

describe('CategoryBreakdownChart - accessible summary', () => {
    it('exposes the chart as an image with a text alternative naming every category and amount', () => {
        render(<CategoryBreakdownChart data={sampleData} />)

        const chart = screen.getByRole('img', { name: /category breakdown/i })
        const accessibleName = chart.getAttribute('aria-label') ?? ''

        expect(accessibleName).toContain('Food')
        expect(accessibleName).toContain(formatCurrency(150))
        expect(accessibleName).toContain('Transport')
        expect(accessibleName).toContain(formatCurrency(42.5))
    })

    it('does not render an accessible image role for an empty breakdown (nothing to summarize)', () => {
        render(<CategoryBreakdownChart data={[]} />)

        expect(screen.queryByRole('img')).not.toBeInTheDocument()
        expect(screen.getByText('No expense data in this period.')).toBeInTheDocument()
    })
})
