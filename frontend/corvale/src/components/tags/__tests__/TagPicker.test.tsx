import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '../../../test/test-utils'
import TagPicker from '../TagPicker'

// X7 (Gate G3): TagPicker renders a bare sibling <label> with no htmlFor and its text input has
// no id, so the label is not programmatically associated. Acceptance spec for X7.

vi.mock('../../../utils/axiosInstance', () => ({
    default: { get: vi.fn().mockRejectedValue(new Error('not used - tagsData supplied')) },
}))

describe('TagPicker - accessible label association', () => {
    it('associates the label with the tag-entry textbox so it resolves by accessible name', () => {
        render(<TagPicker value={[]} onChange={() => {}} tagsData={[]} />)

        expect(screen.getByLabelText('Tags')).toBeInTheDocument()
    })

    it('gives each instance a unique id, so two TagPickers on one page do not collide', () => {
        render(
            <>
                <TagPicker label="Tags A" value={[]} onChange={() => {}} tagsData={[]} />
                <TagPicker label="Tags B" value={[]} onChange={() => {}} tagsData={[]} />
            </>
        )

        const a = screen.getByLabelText('Tags A') as HTMLInputElement
        const b = screen.getByLabelText('Tags B') as HTMLInputElement
        expect(a.id).not.toBe('')
        expect(b.id).not.toBe('')
        expect(a.id).not.toBe(b.id)
    })
})

// X8 (Gate G3): the "Loading tags..." message while the picker's own fetch is pending is a plain
// <p> with no role/aria-live, so a screen-reader user gets no announcement. Acceptance spec.
describe('TagPicker - loading state announced to assistive tech', () => {
    it('exposes a status role for the loading message when no tagsData is supplied', () => {
        render(<TagPicker value={[]} onChange={() => {}} />)

        expect(screen.getByRole('status')).toHaveTextContent('Loading tags...')
    })
})
