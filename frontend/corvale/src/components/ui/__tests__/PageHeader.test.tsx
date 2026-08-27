import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '../../../test/test-utils'
import PageHeader from '../PageHeader'

// V2 added an additive `note` slot to PageHeader (used to hang standing disclaimers under the
// page title). Existing title/description/actions behaviour must be untouched.

describe('PageHeader', () => {
    it('renders the title and optional description', () => {
        render(<PageHeader title="Cash flow forecast" description="Projected balances" />)

        expect(screen.getByRole('heading', { name: 'Cash flow forecast' })).toBeInTheDocument()
        expect(screen.getByText('Projected balances')).toBeInTheDocument()
    })

    it('renders actions', () => {
        render(<PageHeader title="Budgets" actions={<button type="button">Create budget</button>} />)

        expect(screen.getByRole('button', { name: 'Create budget' })).toBeInTheDocument()
    })

    it('renders the note slot after the description when provided', () => {
        render(
            <PageHeader
                title="Debt payoff planner"
                description="Snowball or avalanche plan"
                note={<div role="note">Not financial advice.</div>}
            />
        )

        const note = screen.getByRole('note')
        expect(note).toHaveTextContent('Not financial advice.')

        const description = screen.getByText('Snowball or avalanche plan')
        expect(description.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('renders nothing extra when no note is supplied', () => {
        render(<PageHeader title="Reports" />)

        expect(screen.queryByRole('note')).not.toBeInTheDocument()
    })
})
