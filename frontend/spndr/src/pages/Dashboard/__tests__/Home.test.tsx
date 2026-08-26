import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../../test/test-utils'
import Home from '../Home'
import axiosInstance from '../../../utils/axiosInstance'
import { setCachedUser } from '../../../offline/cachedUser'
import { storeOfflineGrant } from '../../../offline/offlineGrant'
import { createTestOfflineGrant } from '../../../test/offlineGrantFixture'
import { getLocalDb, resetLocalDbForTests } from '../../../db/localDbInstance'
import { Repository } from '../../../db/repositories/Repository'
import { tableInvalidationBus } from '../../../db/invalidation/tableInvalidationBus'
import type { LocalAccount, LocalTransaction } from '../../../domain/types'
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

const accountsRepo = new Repository<LocalAccount>('accounts')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

const seedAccountWithIncome = async () => {
    const db = await getLocalDb()
    const accountId = 'acc-home-1'
    await accountsRepo.upsertFromServer(db, [
        {
            _id: accountId,
            updatedAt: new Date().toISOString(),
            userId: 'user1',
            name: 'Checking',
            type: 'checking',
            currency: 'USD',
            currentBalance: 1000,
            isArchived: false,
        },
    ])
    await transactionsRepo.upsertFromServer(db, [
        {
            _id: 'txn-home-1',
            updatedAt: new Date().toISOString(),
            userId: 'user1',
            accountId,
            categoryId: 'cat-1',
            type: 'income',
            status: 'posted',
            amount: 50000,
            title: 'Paycheck',
            date: new Date().toISOString(),
            splitTransactionId: null,
        },
    ])
    return accountId
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

describe('Home (local-first dashboard summary)', () => {
    it('renders period stat cards computed from the local store, not the server', async () => {
        await seedAccountWithIncome()

        renderWithProviders(<Home />, { route: '/dashboard' })

        await waitFor(() => expect(screen.getByText('Total Income')).toBeInTheDocument())
        const incomeCard = screen.getByText('Total Income').closest('.stat-card')
        expect(incomeCard).toHaveTextContent('$500.00')
        expect(axiosInstance.get).not.toHaveBeenCalledWith(expect.stringContaining('/dashboard/summary'), expect.anything())
    })

    it('refreshes automatically when a local transaction write invalidates the transactions table', async () => {
        const accountId = await seedAccountWithIncome()
        renderWithProviders(<Home />, { route: '/dashboard' })
        await waitFor(() => expect(screen.getByText('Total Income').closest('.stat-card')).toHaveTextContent('$500.00'))

        const db = await getLocalDb()
        await db.transaction(async (tx) => {
            await transactionsRepo.create(tx, {
                _id: 'txn-home-2',
                updatedAt: new Date().toISOString(),
                userId: 'user1',
                accountId,
                categoryId: 'cat-1',
                type: 'income',
                status: 'posted',
                amount: 25000,
                title: 'Bonus',
                date: new Date().toISOString(),
                splitTransactionId: null,
            })
        })
        tableInvalidationBus.publish('transactions')

        await waitFor(() =>
            expect(screen.getByText('Total Income').closest('.stat-card')).toHaveTextContent('$750.00')
        )
    })

    it('labels the quick link to /reports "Reports & Analytics" so it does not read as a separate charts page', async () => {
        renderWithProviders(<Home />, { route: '/dashboard' })

        await waitFor(() => expect(screen.getByText('Total Income')).toBeInTheDocument())
        const link = screen.getByRole('link', { name: /reports & analytics/i })
        expect(link).toHaveAttribute('href', '/reports')
    })
})
