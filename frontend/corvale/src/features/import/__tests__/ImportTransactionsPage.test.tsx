import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor, userEvent } from '@/test/test-utils'
import ImportTransactions from '../ImportTransactionsPage'
import axiosInstance from '@lib/axiosInstance'
import { setCachedUser } from '@platform/offline/cachedUser'
import { storeOfflineGrant } from '@lib/offlineGrant'
import { createTestOfflineGrant } from '@/test/offlineGrantFixture'
import { getLocalDb, resetLocalDbForTests } from '@platform/db/localDbInstance'
import { Repository } from '@platform/db/repositories/Repository'
import type { LocalAccount, LocalCategory } from '@domain/types'
import type { User } from '@lib/types/api'

vi.mock('@lib/axiosInstance', () => ({
    default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
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
const categoriesRepo = new Repository<LocalCategory & { isDefault: boolean; sortOrder: number }>('categories')

const seed = async () => {
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
    await categoriesRepo.upsertFromServer(db, [
        {
            _id: 'cat-food',
            updatedAt: new Date().toISOString(),
            userId: null,
            masterCategoryId: null,
            name: 'Food',
            isDefault: false,
            sortOrder: 0,
            isArchived: false,
        },
    ])
}

const fileInput = (container: HTMLElement) =>
    container.querySelector('input[type="file"]') as HTMLInputElement

beforeEach(async () => {
    vi.stubEnv('VITE_LOCAL_FIRST', 'true')
    resetLocalDbForTests()
    localStorage.removeItem('corvale_active_workspace_id')
    setCachedUser(mockUser)
    await storeOfflineGrant(await createTestOfflineGrant(mockUser._id))
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })
    vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Network Error'))
    vi.mocked(axiosInstance.post).mockRejectedValue(new Error('Network Error'))
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
})

describe('ImportTransactions — delimiter override (BUG-19)', () => {
    it('auto-detects a semicolon CSV and re-parses when the separator is changed', async () => {
        await seed()
        const user = userEvent.setup()
        const { container } = renderWithProviders(<ImportTransactions />, { route: '/transactions/import' })

        await waitFor(() => expect(screen.getByText(/Choose CSV/i)).toBeInTheDocument())

        const csv = ['Date;Description;Amount', '2026-01-05;Grocery;-45,50'].join('\n')
        await user.upload(fileInput(container), new File([csv], 'euro.csv', { type: 'text/csv' }))

        // Mapping step: the semicolon was detected, columns are real.
        await waitFor(() => expect(screen.getByText(/semicolon-separated/i)).toBeInTheDocument())
        const separator = screen.getByLabelText('Column separator') as HTMLSelectElement
        expect(separator.value).toBe(';')

        // Force comma → the row collapses into a single column.
        await user.selectOptions(separator, ',')
        await waitFor(() =>
            expect(screen.getByText(/comma-separated/i)).toBeInTheDocument()
        )
    })

    it('QIF appears in the supported-formats copy', async () => {
        await seed()
        renderWithProviders(<ImportTransactions />, { route: '/transactions/import' })
        await waitFor(() =>
            expect(screen.getByText(/OFX \/ QFX \/ QIF bank exports/i)).toBeInTheDocument()
        )
    })
})
