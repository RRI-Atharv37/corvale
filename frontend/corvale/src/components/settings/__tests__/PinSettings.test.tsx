import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PinSettings from '../PinSettings'

/**
 * SEC-45: the local-lock PIN fields must set `autoComplete="off"` so browser / OS autofill does
 * not retain the PIN. (The feature itself is dormant — BUG-31 — but the attribute lands with the
 * field.)
 */

describe('PinSettings — PIN field credential hygiene (SEC-45)', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('every PIN input opts out of autocomplete', async () => {
        const user = userEvent.setup()
        render(<PinSettings />)

        await user.click(screen.getByRole('button', { name: /set up pin/i }))

        const pinInputs = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
        )
        expect(pinInputs.length).toBeGreaterThanOrEqual(2)
        for (const input of pinInputs) {
            expect(input.getAttribute('autocomplete')).toBe('off')
        }
    })
})
