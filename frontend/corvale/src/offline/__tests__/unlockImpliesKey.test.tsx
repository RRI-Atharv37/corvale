import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetLocalDbForTests, setLocalDb } from '../../db/localDbInstance'
import {
    clearLocalEncryptionKey,
    clearPin,
    hasPinConfigured,
    isLocalDbUnlocked,
    setupPin,
    verifyStoredPin,
} from '../pinStorage'
import PinGate from '../PinGate'

/**
 * Acceptance spec for PIN-gate/key coupling (S10, SEC-03).
 *
 * `PinGate.tsx` today gates purely on `sessionStorage.getItem('corvale_pin_unlocked') === '1'`
 * (`SESSION_UNLOCKED_KEY`). Setting that key from devtools renders the whole dashboard without
 * ever entering a PIN. Combined with SEC-01 the PIN currently provides no confidentiality on web
 * at all; even once SEC-01/SEC-02 land, a storage-sentinel gate stays bypassable independent of
 * whether the data is actually decryptable.
 *
 * Contract assumed here: unlocked state must be a *consequence* of the local DB actually holding
 * the derived encryption key, not a flag anything can set. `offline/pinStorage.ts` gains:
 *
 *   export const isLocalDbUnlocked(): Promise<boolean>
 *     // true if the local DB reports `hasEncryptionKey()`, or if the current driver has no
 *     // encryption surface at all (no PIN feature in this build) - false whenever a PIN is
 *     // configured but the key hasn't (yet, or any more) been applied this session.
 *   export const clearLocalEncryptionKey(): Promise<void>
 *     // clears the key from wherever it's held (worker memory / SQLCipher handle), for lock,
 *     // hide-timeout, and logout to call.
 *
 * `PinGate` is refactored to resolve `isLocalDbUnlocked()` (async - checking the DB, not reading
 * a synchronous flag) before ever treating the session as unlocked, so `sessionStorage` tampering
 * alone can no longer render children with the local financial data still sitting unreadable
 * behind a key nobody derived this session.
 */

vi.mock('../wipeLocalData', () => ({
    wipeLocalData: vi.fn(async () => {}),
}))

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

const SESSION_UNLOCKED_KEY = 'corvale_pin_unlocked'
const PIN = '284915'

const renderGate = () =>
    render(
        <MemoryRouter>
            <PinGate>
                <div data-testid="secret">Balance: $42,000</div>
            </PinGate>
        </MemoryRouter>
    )

describe('Unlock implies key, not a storage sentinel (S10, SEC-03)', () => {
    let fakeDb: FakeEncryptableDb

    beforeEach(() => {
        localStorage.clear()
        sessionStorage.clear()
        vi.stubEnv('VITE_LOCAL_FIRST', 'true')
        vi.stubEnv('VITE_LOCAL_PIN', 'true')
        fakeDb = new FakeEncryptableDb()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLocalDb(fakeDb as any)
    })

    afterEach(() => {
        resetLocalDbForTests()
        vi.unstubAllEnvs()
        vi.restoreAllMocks()
        clearPin()
    })

    it('does not render children from a tampered sessionStorage flag when the DB never actually holds the key', async () => {
        await setupPin(PIN)
        // Simulate a reload / new worker: the derived key is gone even though a PIN was set up
        // earlier in this browser profile.
        fakeDb.clearEncryptionKey()
        // Simulate devtools tampering - the exact vulnerability SEC-03 describes.
        sessionStorage.setItem(SESSION_UNLOCKED_KEY, '1')

        renderGate()

        await waitFor(() => {
            expect(screen.getByLabelText(/pin/i)).toBeInTheDocument()
        })
        expect(screen.queryByTestId('secret')).not.toBeInTheDocument()
    })

    it('renders children once the correct PIN is entered and the key is actually applied', async () => {
        await setupPin(PIN)
        fakeDb.clearEncryptionKey()

        const user = userEvent.setup()
        renderGate()

        await waitFor(() => expect(screen.getByLabelText(/pin/i)).toBeInTheDocument())
        await user.type(screen.getByLabelText(/pin/i), PIN)
        await user.click(screen.getByRole('button', { name: /unlock/i }))

        await waitFor(() => expect(screen.getByTestId('secret')).toBeInTheDocument())
        expect(fakeDb.hasEncryptionKey()).toBe(true)
    })

    it('passes through unaffected when no PIN has been configured (regression)', async () => {
        expect(hasPinConfigured()).toBe(false)

        renderGate()

        await waitFor(() => expect(screen.getByTestId('secret')).toBeInTheDocument())
    })

    it('passes through unaffected when local-first is disabled (regression)', async () => {
        vi.stubEnv('VITE_LOCAL_FIRST', 'false')
        await setupPin(PIN)

        renderGate()

        await waitFor(() => expect(screen.getByTestId('secret')).toBeInTheDocument())
    })
})

describe('Clearing the local encryption key (S10, SEC-03)', () => {
    let fakeDb: FakeEncryptableDb

    beforeEach(() => {
        localStorage.clear()
        fakeDb = new FakeEncryptableDb()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLocalDb(fakeDb as any)
    })

    afterEach(() => {
        resetLocalDbForTests()
        clearPin()
    })

    it('isLocalDbUnlocked reflects the DB holding a key after a correct verify', async () => {
        await setupPin(PIN)

        expect(await isLocalDbUnlocked()).toBe(true)
    })

    it('clearLocalEncryptionKey makes isLocalDbUnlocked report false again - for lock / hide-timeout / logout', async () => {
        await setupPin(PIN)
        expect(await isLocalDbUnlocked()).toBe(true)

        await clearLocalEncryptionKey()

        expect(await isLocalDbUnlocked()).toBe(false)
        // Re-entering the correct PIN must still work after an explicit lock.
        expect(await verifyStoredPin(PIN)).toBe(true)
        expect(await isLocalDbUnlocked()).toBe(true)
    })
})
