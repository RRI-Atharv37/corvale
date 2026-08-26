import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, userEvent, waitFor, within } from '../../../test/test-utils'
import Modal from '../Modal'

// X7 (Gate G3): Modal.tsx already has role="dialog"/aria-modal/aria-labelledby and closes on
// Escape, but it never moves focus into the dialog on open and never traps Tab navigation - a
// keyboard/screen-reader user can Tab straight through the modal into page content behind the
// backdrop. This suite is the acceptance spec for that fix.

const TriggerAndModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => (
    <div>
        <button type="button">Outside before</button>
        <Modal open={open} onClose={onClose} title="Confirm action">
            <button type="button">First field</button>
            <button type="button">Second field</button>
        </Modal>
        <button type="button">Outside after</button>
    </div>
)

describe('Modal - focus management', () => {
    it('moves focus inside the dialog when it opens', async () => {
        render(<TriggerAndModal open={true} onClose={() => {}} />)

        const dialog = screen.getByRole('dialog')
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    })

    it('traps forward Tab navigation within the dialog', async () => {
        const user = userEvent.setup()
        render(<TriggerAndModal open={true} onClose={() => {}} />)

        const dialog = screen.getByRole('dialog')
        const focusable = within(dialog).getAllByRole('button')
        const last = focusable[focusable.length - 1]

        last.focus()
        await user.tab()

        expect(dialog.contains(document.activeElement)).toBe(true)
        expect(document.activeElement).not.toBe(screen.getByText('Outside after'))
    })

    it('traps backward Shift+Tab navigation within the dialog', async () => {
        const user = userEvent.setup()
        render(<TriggerAndModal open={true} onClose={() => {}} />)

        const dialog = screen.getByRole('dialog')
        const focusable = within(dialog).getAllByRole('button')
        const first = focusable[0]

        first.focus()
        await user.tab({ shift: true })

        expect(dialog.contains(document.activeElement)).toBe(true)
        expect(document.activeElement).not.toBe(screen.getByText('Outside before'))
    })

    it('still closes on Escape', async () => {
        const onClose = vi.fn()
        const user = userEvent.setup()
        render(<TriggerAndModal open={true} onClose={onClose} />)

        await user.keyboard('{Escape}')

        expect(onClose).toHaveBeenCalled()
    })
})
