import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '../../../test/test-utils'
import Disclaimer from '../Disclaimer'

// V2 (pre-v1.0.0): shared standing disclaimer for Corvale's predictive / advisory surfaces.
// role="note", tone variants, and deliberately NOT dismissible (always-on context, not a hint).

describe('Disclaimer', () => {
    it('exposes its content to assistive tech as a note landmark', () => {
        render(<Disclaimer>Projections are estimates.</Disclaimer>)

        expect(screen.getByRole('note')).toHaveTextContent('Projections are estimates.')
    })

    it('defaults to the info tone', () => {
        render(<Disclaimer>Info copy</Disclaimer>)

        // info tone does not use the warning accent colour
        expect(screen.getByRole('note').className).not.toMatch(/warning/)
    })

    it('applies caution styling when tone="caution"', () => {
        render(<Disclaimer tone="caution">Not financial advice.</Disclaimer>)

        expect(screen.getByRole('note').className).toMatch(/warning/)
    })

    it('is not dismissible - renders no interactive control', () => {
        render(<Disclaimer tone="caution">Not financial advice.</Disclaimer>)

        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('merges a caller-supplied className', () => {
        render(<Disclaimer className="mt-6">Copy</Disclaimer>)

        expect(screen.getByRole('note')).toHaveClass('mt-6')
    })
})
