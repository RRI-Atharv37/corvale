import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import FormField, { TextAreaField } from '../FormField'

// X7 (Gate G3): FormField/TextAreaField render a bare sibling <label> with no htmlFor and an
// <input>/<textarea> with no id, so the label is not programmatically associated - this is the
// most widely reused form component in the app (Budgets, SavingsGoals, Recurring, Categories,
// Tags, Workspaces, import mapping, etc. all build their forms on it). Acceptance spec for X7.

describe('FormField - accessible label association', () => {
    it('associates the label with the input so it resolves by accessible name', () => {
        render(<FormField label="Title" value="" onChange={() => {}} />)

        expect(screen.getByLabelText('Title')).toBeInTheDocument()
    })

    it('gives each instance a unique id, so two FormFields on one page do not collide', () => {
        render(
            <>
                <FormField label="Title" value="" onChange={() => {}} />
                <FormField label="Amount" value="" onChange={() => {}} />
            </>
        )

        const title = screen.getByLabelText('Title') as HTMLInputElement
        const amount = screen.getByLabelText('Amount') as HTMLInputElement
        expect(title.id).not.toBe('')
        expect(amount.id).not.toBe('')
        expect(title.id).not.toBe(amount.id)
    })
})

describe('TextAreaField - accessible label association', () => {
    it('associates the label with the textarea so it resolves by accessible name', () => {
        render(<TextAreaField label="Notes" value="" onChange={() => {}} />)

        expect(screen.getByLabelText('Notes')).toBeInTheDocument()
    })
})
