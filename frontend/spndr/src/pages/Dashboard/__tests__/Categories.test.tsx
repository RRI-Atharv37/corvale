import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor, within, userEvent, fireEvent } from '../../../test/test-utils'
import Categories from '../Categories'
import axiosInstance from '../../../utils/axiosInstance'
import { setCachedUser } from '../../../offline/cachedUser'
import { storeOfflineGrant } from '../../../offline/offlineGrant'
import { createTestOfflineGrant } from '../../../test/offlineGrantFixture'
import { getLocalDb, resetLocalDbForTests } from '../../../db/localDbInstance'
import { Repository } from '../../../db/repositories/Repository'
import type { LocalCategory } from '../../../domain/types'
import type { User } from '../../../types/api'

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

type LocalCategoryRecord = LocalCategory & { icon?: string; isDefault: boolean; sortOrder: number }

const categoriesRepo = new Repository<LocalCategoryRecord>('categories')

const seedCategories = async () => {
    const db = await getLocalDb()
    await categoriesRepo.upsertFromServer(db, [
        {
            _id: 'master-1',
            updatedAt: new Date().toISOString(),
            userId: null,
            masterCategoryId: null,
            name: 'Food & Dining',
            icon: 'utensils',
            isDefault: false,
            isArchived: false,
            sortOrder: 0,
        },
        {
            _id: 'cat-1',
            updatedAt: new Date().toISOString(),
            userId: 'user1',
            masterCategoryId: 'master-1',
            name: 'Groceries',
            icon: 'shopping-bag',
            isDefault: false,
            isArchived: false,
            sortOrder: 0,
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

describe('Categories (local-first)', () => {
    it('renders master and sub-categories seeded in the local store', async () => {
        await seedCategories()

        renderWithProviders(<Categories />, { route: '/categories' })

        await waitFor(() => expect(screen.getByText('Food & Dining')).toBeInTheDocument())
        expect(screen.getByText('Groceries')).toBeInTheDocument()
        const calledUrls = vi.mocked(axiosInstance.get).mock.calls.map((call) => call[0])
        expect(calledUrls.some((url) => typeof url === 'string' && url.includes('/categories'))).toBe(false)
    })

    it('creates a sub-category through the local store and reflects it in a re-render', async () => {
        await seedCategories()
        const user = userEvent.setup()

        renderWithProviders(<Categories />, { route: '/categories' })
        await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: /add category/i }))
        const nameInput = screen.getByPlaceholderText('Groceries, Dining out, etc.')
        await user.type(nameInput, 'Restaurants')

        // happy-dom does not implement the browser's implicit "click a type=submit button
        // submits its form" behavior reliably inside this nested modal structure, so drive the
        // submit event directly - this still exercises the real `onSubmit={handleCreate}` handler.
        fireEvent.submit(nameInput.closest('form') as HTMLFormElement)

        await waitFor(() => expect(screen.getByText('Restaurants')).toBeInTheDocument())

        const db = await getLocalDb()
        const rows = await categoriesRepo.list(db)
        const created = rows.find((row) => row.name === 'Restaurants')
        expect(created).toBeDefined()
        expect(created?.masterCategoryId).toBe('master-1')
        // Sibling ('Groceries') already has sortOrder 0, so the new one must sort after it.
        expect(created?.sortOrder).toBe(1)
    })

    it('archives a sub-category through the local store and removes it from the list', async () => {
        await seedCategories()
        const user = userEvent.setup()

        renderWithProviders(<Categories />, { route: '/categories' })
        await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument())

        const row = screen.getByText('Groceries').closest('div.flex.items-center.justify-between') as HTMLElement
        await user.click(within(row).getByRole('button', { name: /archive category/i }))

        const dialog = await screen.findByRole('dialog', { name: /archive category/i })
        await user.click(within(dialog).getByRole('button', { name: /^archive$/i }))

        await waitFor(() => expect(screen.queryByText('Groceries')).not.toBeInTheDocument())

        const db = await getLocalDb()
        const stored = await categoriesRepo.findById(db, 'cat-1')
        expect(stored?.isArchived).toBe(true)
    })
})
