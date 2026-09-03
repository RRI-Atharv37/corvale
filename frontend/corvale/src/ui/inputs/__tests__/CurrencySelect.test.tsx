import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import CurrencySelect from '../CurrencySelect'

// X7 (Gate G3): CurrencySelect renders a bare sibling <label> with no htmlFor and a <select> with
// no id, so the label is not programmatically associated. Acceptance spec for X7.

describe('CurrencySelect - accessible label association', () => {
    it('associates the label with the select so it resolves by accessible name', () => {
        render(<CurrencySelect value="USD" onChange={() => {}} />)

        expect(screen.getByLabelText('Currency')).toBeInTheDocument()
    })

    it('gives each instance a unique id, so two CurrencySelects on one page do not collide', () => {
        render(
            <>
                <CurrencySelect label="From currency" value="USD" onChange={() => {}} />
                <CurrencySelect label="To currency" value="EUR" onChange={() => {}} />
            </>
        )

        const from = screen.getByLabelText('From currency') as HTMLSelectElement
        const to = screen.getByLabelText('To currency') as HTMLSelectElement
        expect(from.id).not.toBe('')
        expect(to.id).not.toBe('')
        expect(from.id).not.toBe(to.id)
    })
})
