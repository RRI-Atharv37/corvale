import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor, within, userEvent, fireEvent } from '../../../test/test-utils'
import Tags from '../Tags'
import axiosInstance from '../../../utils/axiosInstance'
import { setCachedUser } from '../../../offline/cachedUser'
import { storeOfflineGrant } from '../../../offline/offlineGrant'
import { createTestOfflineGrant } from '../../../test/offlineGrantFixture'
import { getLocalDb, resetLocalDbForTests } from '../../../db/localDbInstance'
import { Repository } from '../../../db/repositories/Repository'
import type { LocalTag } from '../../../domain/types'
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

const tagsRepo = new Repository<LocalTag>('tags')

const seedTag = async () => {
    const db = await getLocalDb()
    await tagsRepo.upsertFromServer(db, [
        {
            _id: 'tag-1',
            updatedAt: new Date().toISOString(),
            userId: 'user1',
            name: 'Essential',
            color: '#6B7280',
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

describe('Tags (local-first)', () => {
    it('renders tags seeded in the local store', async () => {
        await seedTag()

        renderWithProviders(<Tags />, { route: '/tags' })

        await waitFor(() => expect(screen.getByText('Essential')).toBeInTheDocument())
        const calledUrls = vi.mocked(axiosInstance.get).mock.calls.map((call) => call[0])
        expect(calledUrls.some((url) => typeof url === 'string' && url.includes('/tags'))).toBe(false)
    })

    it('creates a tag through the local store and reflects it in a re-render', async () => {
        await seedTag()
        const user = userEvent.setup()

        renderWithProviders(<Tags />, { route: '/tags' })
        await waitFor(() => expect(screen.getByText('Essential')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: /add tag/i }))
        const nameInput = screen.getByPlaceholderText('Essential, subscription, etc.')
        await user.type(nameInput, 'Subscription')

        // happy-dom does not implement the browser's implicit "click a type=submit button
        // submits its form" behavior reliably inside this nested modal structure, so drive the
        // submit event directly - this still exercises the real `onSubmit={handleCreate}` handler.
        fireEvent.submit(nameInput.closest('form') as HTMLFormElement)

        await waitFor(() => expect(screen.getByText('Subscription')).toBeInTheDocument())

        const db = await getLocalDb()
        const rows = await tagsRepo.list(db)
        const created = rows.find((row) => row.name === 'Subscription')
        expect(created).toBeDefined()
        expect(created?.userId).toBe('user1')
    })

    it('deletes a tag through the local store (real tombstone, not archive)', async () => {
        await seedTag()
        const user = userEvent.setup()

        renderWithProviders(<Tags />, { route: '/tags' })
        await waitFor(() => expect(screen.getByText('Essential')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: /delete essential/i }))

        const dialog = await screen.findByRole('dialog', { name: /delete tag/i })
        await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))

        await waitFor(() => expect(screen.queryByText('Essential')).not.toBeInTheDocument())

        const db = await getLocalDb()
        const stored = await tagsRepo.findById(db, 'tag-1')
        expect(stored).toBeNull()

        const rows = await db.select<{ deletedAt: string | null }>(
            'SELECT deletedAt FROM tags WHERE _id = ?',
            ['tag-1']
        )
        expect(rows[0]?.deletedAt).not.toBeNull()
    })
})
