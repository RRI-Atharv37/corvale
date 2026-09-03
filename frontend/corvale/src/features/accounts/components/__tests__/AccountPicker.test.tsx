import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen } from '@/test/test-utils'
import AccountPicker from '../AccountPicker'
import type { Account } from '@lib/types/api'

// X7 (Gate G3): AccountPicker renders a bare sibling <label> with no htmlFor and a <select> with
// no id, so the label is not programmatically associated. Acceptance spec for X7.

vi.mock('@lib/axiosInstance', () => ({
    default: { get: vi.fn().mockRejectedValue(new Error('not used - accountsData supplied')) },
}))

const accountsData: Account[] = [
    {
        _id: 'acc1',
        userId: 'user1',
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        openingBalance: 0,
        currentBalance: 1000,
        isDefault: true,
        isArchived: false,
    },
]

describe('AccountPicker - accessible label association', () => {
    it('associates the label with the select so it resolves by accessible name', () => {
        renderWithProviders(<AccountPicker value="" onChange={() => {}} accountsData={accountsData} />)

        expect(screen.getByLabelText('Account')).toBeInTheDocument()
    })

    it('gives each instance a unique id, so two AccountPickers on one page do not collide', () => {
        renderWithProviders(
            <>
                <AccountPicker label="From account" value="" onChange={() => {}} accountsData={accountsData} />
                <AccountPicker label="To account" value="" onChange={() => {}} accountsData={accountsData} />
            </>
        )

        const from = screen.getByLabelText('From account') as HTMLSelectElement
        const to = screen.getByLabelText('To account') as HTMLSelectElement
        expect(from.id).not.toBe('')
        expect(to.id).not.toBe('')
        expect(from.id).not.toBe(to.id)
    })
})

// X8 (Gate G3): the "Loading accounts..." message while the picker's own fetch is pending is a
// plain <p> with no role/aria-live, so a screen-reader user gets no announcement. Acceptance spec.
describe('AccountPicker - loading state announced to assistive tech', () => {
    it('exposes a status role for the loading message when no accountsData is supplied', () => {
        renderWithProviders(<AccountPicker value="" onChange={() => {}} />)

        expect(screen.getByRole('status')).toHaveTextContent('Loading accounts...')
    })
})
