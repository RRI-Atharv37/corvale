import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '../../../test/test-utils'
import CategoryPicker from '../CategoryPicker'
import type { CategoriesResponse } from '../../../types/api'

// X7 (Gate G3): CategoryPicker renders a bare sibling <label> with no htmlFor and a <select> with
// no id, so the label is not programmatically associated. Acceptance spec for X7.

vi.mock('../../../utils/axiosInstance', () => ({
    default: { get: vi.fn().mockRejectedValue(new Error('not used - categoriesData supplied')) },
}))

const categoriesData: CategoriesResponse = {
    masters: [{ _id: 'm1', userId: null, masterCategoryId: null, name: 'Food', isDefault: true, isArchived: false, sortOrder: 0 }],
    userCategories: [],
}

describe('CategoryPicker - accessible label association', () => {
    it('associates the label with the select so it resolves by accessible name', () => {
        render(<CategoryPicker value="" onChange={() => {}} categoriesData={categoriesData} />)

        expect(screen.getByLabelText('Category')).toBeInTheDocument()
    })

    it('gives each instance a unique id, so two CategoryPickers on one page do not collide', () => {
        render(
            <>
                <CategoryPicker label="From category" value="" onChange={() => {}} categoriesData={categoriesData} />
                <CategoryPicker label="To category" value="" onChange={() => {}} categoriesData={categoriesData} />
            </>
        )

        const from = screen.getByLabelText('From category') as HTMLSelectElement
        const to = screen.getByLabelText('To category') as HTMLSelectElement
        expect(from.id).not.toBe('')
        expect(to.id).not.toBe('')
        expect(from.id).not.toBe(to.id)
    })
})

// X8 (Gate G3): the "Loading categories..." message while the picker's own fetch is pending is a
// plain <p> with no role/aria-live, so a screen-reader user gets no announcement. Acceptance spec.
describe('CategoryPicker - loading state announced to assistive tech', () => {
    it('exposes a status role for the loading message when no categoriesData is supplied', () => {
        render(<CategoryPicker value="" onChange={() => {}} />)

        expect(screen.getByRole('status')).toHaveTextContent('Loading categories...')
    })
})
