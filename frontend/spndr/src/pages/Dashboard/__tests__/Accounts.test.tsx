import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor, within, userEvent, fireEvent } from '../../../test/test-utils'
import Accounts from '../Accounts'
import axiosInstance from '../../../utils/axiosInstance'
import { setCachedUser } from '../../../offline/cachedUser'
import { storeOfflineGrant } from '../../../offline/offlineGrant'
import { createTestOfflineGrant } from '../../../test/offlineGrantFixture'
import { getLocalDb, resetLocalDbForTests } from '../../../db/localDbInstance'
import { Repository } from '../../../db/repositories/Repository'
import type { LocalAccount } from '../../../domain/types'
import type { User } from '../../../types/api'

// This page's local-first data layer lives in `../hooks/useAccountsData.ts` - branches on
// `isLocalFirstEnabled()` (read from `import.meta.env.VITE_LOCAL_FIRST`). `vi.stubEnv` works
// against `import.meta.env` under vitest (confirmed by the existing `Home.test.tsx` in this same
// directory, which uses the identical pattern), so no module mock is needed for the flag itself.

vi.mock('../../../utils/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
}))

const mockUser: User = {
    _id: 'user1',
    fullName: 'Jamie Rivera',
    email: 'jamie@example.com',
    timezone: 'UTC',
    preferredCurrency: 'USD',
    exchangeRates: {},
}

const accountsRepo = new Repository<LocalAccount & { isDefault: boolean }>('accounts')

const seedAccount = async () => {
    const db = await getLocalDb()
    await accountsRepo.upsertFromServer(db, [
        {
            _id: 'acc-1',
            updatedAt: new Date().toISOString(),
            userId: 'user1',
            name: 'Checking',
            type: 'checking',
            currency: 'USD',
            currentBalance: 1000,
            openingBalance: 1000,
            isDefault: true,
            isArchived: false,
        },
    ])
}

beforeEach(async () => {
    vi.stubEnv('VITE_LOCAL_FIRST', 'true')
    resetLocalDbForTests()
    setCachedUser(mockUser)
    await storeOfflineGrant(await createTestOfflineGrant(mockUser._id))
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })
    vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Network Error'))
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
})

describe('Accounts (local-first)', () => {
    it('renders accounts seeded in the local store', async () => {
        await seedAccount()

        renderWithProviders(<Accounts />, { route: '/accounts' })

        await waitFor(() => expect(screen.getByText('Checking')).toBeInTheDocument())
        const calledUrls = vi.mocked(axiosInstance.get).mock.calls.map((call) => call[0])
        expect(calledUrls.some((url) => typeof url === 'string' && url.includes('/accounts'))).toBe(false)
    })

    it('creates an account through the local store and reflects it in a re-render', async () => {
        await seedAccount()
        const user = userEvent.setup()

        renderWithProviders(<Accounts />, { route: '/accounts' })
        await waitFor(() => expect(screen.getByText('Checking')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: /add account/i }))
        const nameInput = screen.getByPlaceholderText('Main checking, Cash wallet, etc.')
        await user.type(nameInput, 'Cash wallet')
        await user.clear(screen.getByPlaceholderText('0.00'))
        await user.type(screen.getByPlaceholderText('0.00'), '25')

        // happy-dom does not implement the browser's implicit "click a type=submit button
        // submits its form" behavior reliably inside this nested modal structure, so drive the
        // submit event directly - this still exercises the real `onSubmit={handleCreate}` handler.
        fireEvent.submit(nameInput.closest('form') as HTMLFormElement)

        await waitFor(() => expect(screen.getByText('Cash wallet')).toBeInTheDocument())

        const db = await getLocalDb()
        const rows = await accountsRepo.list(db)
        const created = rows.find((row) => row.name === 'Cash wallet')
        expect(created).toBeDefined()
        expect(created?.currentBalance).toBe(25)
        expect(created?.openingBalance).toBe(25)
        // Only the seeded account should still be default - the new one is not the first
        // personal account, so it must not have flipped the existing default.
        expect(created?.isDefault).toBe(false)
    })

    it('archives an account through the local store and removes it from the list', async () => {
        await seedAccount()
        const user = userEvent.setup()

        renderWithProviders(<Accounts />, { route: '/accounts' })
        await waitFor(() => expect(screen.getByText('Checking')).toBeInTheDocument())

        const card = screen.getByText('Checking').closest('.card') as HTMLElement
        await user.click(within(card).getByRole('button', { name: /archive account/i }))

        const dialog = await screen.findByRole('dialog', { name: /archive account/i })
        await user.click(within(dialog).getByRole('button', { name: /^archive$/i }))

        await waitFor(() => expect(screen.queryByText('Checking')).not.toBeInTheDocument())

        const db = await getLocalDb()
        const stored = await accountsRepo.findById(db, 'acc-1')
        expect(stored?.isArchived).toBe(true)
        expect(stored?.isDefault).toBe(false)
    })
})
