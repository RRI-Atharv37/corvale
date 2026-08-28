import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '../../../test/test-utils'
import LoadingState from '../LoadingState'

// X8 (Gate G3): LoadingState renders a spinning div and a plain <p>, with no role/aria-live, so a
// screen-reader user gets no announcement that content is loading. Acceptance spec for that fix.

describe('LoadingState - announced to assistive tech', () => {
    it('exposes a status role so the message is announced', () => {
        render(<LoadingState message="Loading transactions..." />)

        expect(screen.getByRole('status')).toHaveTextContent('Loading transactions...')
    })

    it('is a polite live region, not an interrupting one', () => {
        render(<LoadingState />)

        expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    })

    it('announces the default message when none is supplied', () => {
        render(<LoadingState />)

        expect(screen.getByRole('status')).toHaveTextContent('Loading...')
    })
})
