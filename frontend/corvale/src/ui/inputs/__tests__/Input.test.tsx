import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, userEvent } from '@/test/test-utils'
import Input from '../Input'

// X7 (Gate G3): Input.tsx's <label> has no htmlFor and the <input> has no id, so the label is
// not programmatically associated - a screen reader announces the field with no name. The
// password-visibility toggle is a bare react-icons glyph with an onClick, not a <button>, so it
// is invisible to keyboard/AT users entirely. This suite is the acceptance spec for X7's fix.

describe('Input - accessible label association', () => {
    it('associates the label with the input so it resolves by accessible name', () => {
        render(
            <Input
                label="Email address"
                type="email"
                value=""
                onChange={() => {}}
                placeholder="you@example.com"
            />
        )

        expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    })

    it('gives each input instance a unique id, so two Inputs on one page do not collide', () => {
        render(
            <>
                <Input label="Email" type="email" value="" onChange={() => {}} placeholder="Email" />
                <Input label="Password" type="password" value="" onChange={() => {}} placeholder="Password" />
            </>
        )

        const email = screen.getByLabelText('Email') as HTMLInputElement
        const password = screen.getByLabelText('Password') as HTMLInputElement
        expect(email.id).not.toBe('')
        expect(password.id).not.toBe('')
        expect(email.id).not.toBe(password.id)
    })
})

describe('Input - password visibility toggle is keyboard accessible', () => {
    it('renders the toggle as a real button with an accessible name', () => {
        render(
            <Input
                label="Password"
                type="password"
                value="hunter2"
                onChange={() => {}}
                placeholder="Password"
            />
        )

        expect(screen.getByRole('button', { name: /show password/i })).toBeInTheDocument()
    })

    it('toggles the input type and accessible name when activated via keyboard', async () => {
        const user = userEvent.setup()
        render(
            <Input
                label="Password"
                type="password"
                value="hunter2"
                onChange={() => {}}
                placeholder="Password"
            />
        )

        const input = screen.getByLabelText('Password') as HTMLInputElement
        expect(input.type).toBe('password')

        const toggle = screen.getByRole('button', { name: /show password/i })
        toggle.focus()
        await user.keyboard('{Enter}')

        expect(input.type).toBe('text')
        expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument()
    })

    it('does not render a toggle button for non-password inputs', () => {
        render(<Input label="Email" type="email" value="" onChange={() => {}} placeholder="Email" />)

        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('does not submit an enclosing form when the toggle is activated', async () => {
        const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
        const user = userEvent.setup()
        render(
            <form onSubmit={onSubmit}>
                <Input label="Password" type="password" value="x" onChange={() => {}} placeholder="Password" />
            </form>
        )

        await user.click(screen.getByRole('button', { name: /show password/i }))

        expect(onSubmit).not.toHaveBeenCalled()
    })
})
