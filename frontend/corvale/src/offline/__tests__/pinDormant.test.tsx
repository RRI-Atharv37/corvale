import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { resetLocalDbForTests, setLocalDb } from '../../db/localDbInstance'
import { clearPin, setupPin } from '../pinStorage'
import PinGate from '../PinGate'
import PinSetupPrompt from '../../components/onboarding/PinSetupPrompt'

/**
 * BUG-31: the local-lock PIN feature ships dormant. `db_set_key` corrupts an already-populated
 * plaintext SQLite file (it needs `PRAGMA rekey`, not a bare `PRAGMA key`), so setting a PIN on
 * the desktop build destroyed the local store. Until encryption-at-rest is keyed from the OS
 * keychain at `db_open`, the whole PIN surface is gated behind `VITE_LOCAL_PIN` (off in every
 * shipped build): `PinGate` must pass through and `PinSetupPrompt` must never open, even for a
 * profile that already has a PIN configured in `localStorage` from a broken earlier build.
 */

vi.mock('../wipeLocalData', () => ({ wipeLocalData: vi.fn(async () => ({ pinCleared: false })) }))

class FakeEncryptableDb {
    key: { passphrase: string; salt: Uint8Array } | null = null
    async setEncryptionKey(passphrase: string, salt: Uint8Array): Promise<void> {
        this.key = { passphrase, salt }
    }
    hasEncryptionKey(): boolean {
        return this.key !== null
    }
    clearEncryptionKey(): void {
        this.key = null
    }
    async exec(): Promise<void> {}
    async select(): Promise<never[]> {
        return []
    }
    async transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
        return fn(this)
    }
    async close(): Promise<void> {}
}

const PIN = '284915'

const renderGate = () =>
    render(
        <MemoryRouter>
            <PinGate>
                <div data-testid="secret">Balance: $42,000</div>
            </PinGate>
        </MemoryRouter>
    )

describe('PIN feature is dormant without VITE_LOCAL_PIN (BUG-31)', () => {
    let fakeDb: FakeEncryptableDb

    beforeEach(() => {
        localStorage.clear()
        sessionStorage.clear()
        vi.stubEnv('VITE_LOCAL_FIRST', 'true')
        fakeDb = new FakeEncryptableDb()
        setLocalDb(fakeDb as unknown as Parameters<typeof setLocalDb>[0])
    })

    afterEach(() => {
        resetLocalDbForTests()
        vi.unstubAllEnvs()
        vi.restoreAllMocks()
        clearPin()
    })

    it('PinGate passes through even with a PIN configured, when the PIN flag is off', async () => {
        vi.stubEnv('VITE_LOCAL_PIN', '')
        await setupPin(PIN)
        fakeDb.clearEncryptionKey()

        renderGate()

        await waitFor(() => expect(screen.getByTestId('secret')).toBeInTheDocument())
        expect(screen.queryByLabelText(/pin/i)).not.toBeInTheDocument()
    })

    it('PinGate locks a configured PIN once the PIN flag is on', async () => {
        vi.stubEnv('VITE_LOCAL_PIN', 'true')
        await setupPin(PIN)
        fakeDb.clearEncryptionKey()

        renderGate()

        await waitFor(() => expect(screen.getByLabelText(/pin/i)).toBeInTheDocument())
        expect(screen.queryByTestId('secret')).not.toBeInTheDocument()
    })

    it('PinSetupPrompt never opens when the PIN flag is off', async () => {
        vi.stubEnv('VITE_LOCAL_PIN', '')
        vi.useFakeTimers()
        try {
            render(<PinSetupPrompt />)
            act(() => {
                vi.advanceTimersByTime(5000)
            })
        } finally {
            vi.useRealTimers()
        }

        expect(screen.queryByText(/secure your offline data/i)).not.toBeInTheDocument()
    })

    it('PinSetupPrompt opens after its delay when the PIN flag is on and no PIN is set', async () => {
        vi.stubEnv('VITE_LOCAL_PIN', 'true')
        vi.useFakeTimers()
        try {
            render(<PinSetupPrompt />)
            act(() => {
                vi.advanceTimersByTime(5000)
            })
        } finally {
            vi.useRealTimers()
        }

        await waitFor(() => expect(screen.getByText(/secure your offline data/i)).toBeInTheDocument())
    })

    it('SEC-45: PinSetupPrompt PIN inputs opt out of autocomplete', async () => {
        vi.stubEnv('VITE_LOCAL_PIN', 'true')
        vi.useFakeTimers()
        try {
            render(<PinSetupPrompt />)
            act(() => {
                vi.advanceTimersByTime(5000)
            })
        } finally {
            vi.useRealTimers()
        }

        await waitFor(() => expect(screen.getByText(/secure your offline data/i)).toBeInTheDocument())
        const pinInputs = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
        )
        expect(pinInputs.length).toBe(2)
        for (const input of pinInputs) {
            expect(input.getAttribute('autocomplete')).toBe('off')
        }
    })
})
