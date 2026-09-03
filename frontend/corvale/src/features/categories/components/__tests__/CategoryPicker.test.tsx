import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import CategoryPicker from '../CategoryPicker'
import type { CategoriesResponse } from '@features/categories/types'

// V4 (pre-v1.0.0): CategoryPicker is an ARIA 1.2 editable combobox, not a native <select>+<optgroup>.
// This file is the acceptance spec for that rebuild. It also carries forward the X7/X8 (Gate G3)
// guarantees: the label is programmatically associated, each instance gets a unique id, and the
// picker's own loading message is announced.

vi.mock('@lib/axiosInstance', () => ({
    default: { get: vi.fn().mockRejectedValue(new Error('not used - categoriesData supplied')) },
}))

const cat = (over: Partial<CategoriesResponse['masters'][number]> & { _id: string; name: string }) => ({
    userId: null,
    masterCategoryId: null,
    isDefault: false,
    isArchived: false,
    sortOrder: 0,
    ...over,
})

const categoriesData: CategoriesResponse = {
    masters: [
        cat({ _id: 'm-food', name: 'Food' }),
        cat({ _id: 'm-home', name: 'Home' }),
    ],
    userCategories: [
        cat({ _id: 's-dining', name: 'Dining out', masterCategoryId: 'm-food', sortOrder: 0 }),
        cat({ _id: 's-groceries', name: 'Groceries', masterCategoryId: 'm-food', sortOrder: 1 }),
        cat({ _id: 's-rent', name: 'Rent', masterCategoryId: 'm-home', sortOrder: 0 }),
    ],
}

describe('CategoryPicker - accessible label association (X7)', () => {
    it('associates the label with the combobox so it resolves by accessible name', () => {
        render(<CategoryPicker value="" onChange={() => {}} categoriesData={categoriesData} />)

        expect(screen.getByLabelText('Category')).toBeInTheDocument()
        expect(screen.getByRole('combobox', { name: 'Category' })).toBeInTheDocument()
    })

    it('gives each instance a unique id, so two CategoryPickers on one page do not collide', () => {
        render(
            <>
                <CategoryPicker label="From category" value="" onChange={() => {}} categoriesData={categoriesData} />
                <CategoryPicker label="To category" value="" onChange={() => {}} categoriesData={categoriesData} />
            </>
        )

        const from = screen.getByLabelText('From category')
        const to = screen.getByLabelText('To category')
        expect(from.id).not.toBe('')
        expect(to.id).not.toBe('')
        expect(from.id).not.toBe(to.id)
    })
})

describe('CategoryPicker - loading state announced to assistive tech (X8)', () => {
    it('exposes a status role for the loading message when no categoriesData is supplied', () => {
        render(<CategoryPicker value="" onChange={() => {}} />)

        expect(screen.getByRole('status')).toHaveTextContent('Loading categories...')
    })
})

describe('CategoryPicker - editable combobox (V4)', () => {
    it('marks the input as a combobox and keeps native required constraint validation', () => {
        render(<CategoryPicker value="" onChange={() => {}} required categoriesData={categoriesData} />)

        const input = screen.getByRole('combobox', { name: 'Category' }) as HTMLInputElement
        expect(input.tagName).toBe('INPUT')
        expect(input).toBeRequired()
        expect(input.checkValidity()).toBe(false)
        expect(input).toHaveAttribute('aria-expanded', 'false')
    })

    it('opens the listbox on focus and renders masters as presentation-headed groups', async () => {
        const user = userEvent.setup()
        render(<CategoryPicker value="" onChange={() => {}} categoriesData={categoriesData} />)

        await user.click(screen.getByRole('combobox', { name: 'Category' }))

        const listbox = await screen.findByRole('listbox')
        expect(screen.getByRole('combobox', { name: 'Category' })).toHaveAttribute('aria-expanded', 'true')

        const groups = within(listbox).getAllByRole('group')
        expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Food', 'Home'])

        // The master is a keyboard-navigable option, distinct from any sub, with a visually-hidden
        // suffix so a screen-reader user can tell it apart.
        expect(within(listbox).getByRole('option', { name: 'Food (master category)' })).toBeInTheDocument()
        expect(within(listbox).getByRole('option', { name: 'Home (master category)' })).toBeInTheDocument()

        // Every option (masters + subs) is selectable.
        expect(within(listbox).getAllByRole('option')).toHaveLength(5)
        expect(within(listbox).getByRole('option', { name: 'Dining out' })).toBeInTheDocument()
        expect(within(listbox).getByRole('option', { name: 'Groceries' })).toBeInTheDocument()
        expect(within(listbox).getByRole('option', { name: 'Rent' })).toBeInTheDocument()
    })

    it('filters options by a case-insensitive substring as the user types', async () => {
        const user = userEvent.setup()
        render(<CategoryPicker value="" onChange={() => {}} categoriesData={categoriesData} />)

        const input = screen.getByRole('combobox', { name: 'Category' })
        await user.click(input)
        await user.type(input, 'gro')

        const listbox = screen.getByRole('listbox')
        const options = within(listbox).getAllByRole('option')
        expect(options).toHaveLength(1)
        expect(options[0]).toHaveAccessibleName('Groceries')
    })

    it('moves aria-activedescendant with the arrow keys and selects on Enter', async () => {
        const onChange = vi.fn()
        const user = userEvent.setup()
        render(<CategoryPicker value="" onChange={onChange} categoriesData={categoriesData} />)

        const input = screen.getByRole('combobox', { name: 'Category' })
        await user.click(input)
        await user.keyboard('{ArrowDown}') // Food (master)
        await user.keyboard('{ArrowDown}') // Dining out

        const listbox = screen.getByRole('listbox')
        const dining = within(listbox).getByRole('option', { name: 'Dining out' })
        expect(input).toHaveAttribute('aria-activedescendant', dining.id)

        await user.keyboard('{Enter}')
        expect(onChange).toHaveBeenCalledWith('s-dining')
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('selecting the master option calls onChange with the master id', async () => {
        const onChange = vi.fn()
        const user = userEvent.setup()
        render(<CategoryPicker value="" onChange={onChange} categoriesData={categoriesData} />)

        await user.click(screen.getByRole('combobox', { name: 'Category' }))
        await user.click(screen.getByRole('option', { name: 'Home (master category)' }))

        expect(onChange).toHaveBeenCalledWith('m-home')
    })

    it('Enter does not submit the enclosing form while the listbox is open', async () => {
        const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
        const user = userEvent.setup()
        render(
            <form onSubmit={onSubmit}>
                <CategoryPicker value="" onChange={() => {}} categoriesData={categoriesData} />
                <button type="submit">Save</button>
            </form>
        )

        const input = screen.getByRole('combobox', { name: 'Category' })
        await user.click(input)
        await user.keyboard('{ArrowDown}')
        await user.keyboard('{Enter}')

        expect(onSubmit).not.toHaveBeenCalled()
    })

    it('Escape closes the listbox without propagating to an enclosing handler', async () => {
        const onKeyDown = vi.fn()
        const user = userEvent.setup()
        render(
            <div onKeyDown={onKeyDown}>
                <CategoryPicker value="" onChange={() => {}} categoriesData={categoriesData} />
            </div>
        )

        const input = screen.getByRole('combobox', { name: 'Category' })
        await user.click(input)
        expect(screen.getByRole('listbox')).toBeInTheDocument()

        await user.keyboard('{Escape}')
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
        expect(onKeyDown).not.toHaveBeenCalled()

        // A second Escape (listbox already closed) is allowed to propagate - that is how the
        // enclosing modal still closes on Escape.
        await user.keyboard('{Escape}')
        expect(onKeyDown).toHaveBeenCalled()
    })

    it('expands in-flow rather than as an absolutely-positioned popup', async () => {
        const user = userEvent.setup()
        render(<CategoryPicker value="" onChange={() => {}} categoriesData={categoriesData} />)

        await user.click(screen.getByRole('combobox', { name: 'Category' }))
        const listbox = screen.getByRole('listbox')
        expect(getComputedStyle(listbox).position).not.toBe('absolute')
        expect(getComputedStyle(listbox).position).not.toBe('fixed')
    })

    it('restricts the list to one master when masterCategoryId is given', async () => {
        const user = userEvent.setup()
        render(
            <CategoryPicker
                value=""
                onChange={() => {}}
                masterCategoryId="m-home"
                categoriesData={categoriesData}
            />
        )

        await user.click(screen.getByRole('combobox', { name: 'Category' }))
        const listbox = screen.getByRole('listbox')
        expect(within(listbox).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Home'])
    })

    it('shows the selected category name in the input once chosen', () => {
        const { rerender } = render(
            <CategoryPicker value="" onChange={() => {}} categoriesData={categoriesData} />
        )

        rerender(<CategoryPicker value="s-rent" onChange={() => {}} categoriesData={categoriesData} />)
        expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('Rent')
    })
})
