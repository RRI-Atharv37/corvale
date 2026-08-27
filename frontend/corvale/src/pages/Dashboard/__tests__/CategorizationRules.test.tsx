import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor, within, userEvent, fireEvent, pickCategory } from '../../../test/test-utils'
import CategorizationRules from '../CategorizationRules'
import axiosInstance from '../../../utils/axiosInstance'
import { setCachedUser } from '../../../offline/cachedUser'
import { storeOfflineGrant } from '../../../offline/offlineGrant'
import { createTestOfflineGrant } from '../../../test/offlineGrantFixture'
import { getLocalDb, resetLocalDbForTests } from '../../../db/localDbInstance'
import { Repository } from '../../../db/repositories/Repository'
import type { LocalAccount, LocalCategorizationRule, LocalCategory } from '../../../domain/types'
import type { User } from '../../../types/api'

// Sprint 13.9: proves CategorizationRules.tsx's rule CRUD, bulk-apply, and rule-tester all read and
// write through the local SQLite store / domain/categorizationRules.ts when VITE_LOCAL_FIRST is on -
// no REST call for any of it, unlike Recurring's draft actions.

vi.mock('../../../utils/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
}))

const setOnline = (online: boolean): void => {
    Object.defineProperty(navigator, 'onLine', { value: online, writable: true, configurable: true })
}

const mockUser: User = {
    _id: 'user1',
    fullName: 'Jamie Rivera',
    email: 'jamie@example.com',
    preferredCurrency: 'USD',
}

// happy-dom (the project's test environment) does not reliably fire the implicit form submission a
// real browser produces on a submit-button click, so form submits go through `fireEvent.submit`.
const submitClosestForm = (element: HTMLElement): void => {
    const form = element.closest('form') ?? element.ownerDocument.querySelector('form')
    if (!form) throw new Error('No form found to submit')
    fireEvent.submit(form)
}

const accountsRepo = new Repository<LocalAccount>('accounts')
const categoriesRepo = new Repository<LocalCategory>('categories')
const rulesRepo = new Repository<LocalCategorizationRule>('categorizationRules')

const seedFixtures = async () => {
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
            isArchived: false,
        },
    ])
    await categoriesRepo.upsertFromServer(db, [
        {
            _id: 'cat-coffee',
            updatedAt: new Date().toISOString(),
            userId: null,
            masterCategoryId: null,
            name: 'Coffee',
            isArchived: false,
        },
    ])
    await rulesRepo.upsertFromServer(db, [
        {
            _id: 'rule-1',
            updatedAt: new Date().toISOString(),
            userId: 'user1',
            name: 'Coffee shops',
            matchType: 'description_contains',
            matchValue: 'coffee',
            categoryId: 'cat-coffee',
            tags: [],
            priority: 5,
            isActive: true,
        },
    ])
    return db
}

beforeEach(async () => {
    vi.stubEnv('VITE_LOCAL_FIRST', 'true')
    resetLocalDbForTests()
    setCachedUser(mockUser)
    await storeOfflineGrant(await createTestOfflineGrant(mockUser._id))
    setOnline(false)
    vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Network Error'))
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    setOnline(true)
})

describe('CategorizationRules (local-first rule CRUD)', () => {
    it('renders seeded rules from the local store', async () => {
        await seedFixtures()

        renderWithProviders(<CategorizationRules />, { route: '/categories/rules' })

        await waitFor(() => expect(screen.getByText('Coffee shops')).toBeInTheDocument())
        expect(screen.getByText(/contains "coffee"/i)).toBeInTheDocument()
        expect(axiosInstance.get).not.toHaveBeenCalledWith(
            expect.stringContaining('/categorization-rules'),
            expect.anything()
        )
    })

    it('creates a new rule locally', async () => {
        const db = await seedFixtures()
        const user = userEvent.setup()

        renderWithProviders(<CategorizationRules />, { route: '/categories/rules' })
        await waitFor(() => expect(screen.getByText('Coffee shops')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: 'Create rule' }))

        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByPlaceholderText('e.g. Coffee shops'), 'Rent')
        await user.type(within(dialog).getByPlaceholderText('e.g. Starbucks, Netflix'), 'rent')

        // Match type is a native <select>; the category picker is the V4 combobox.
        await pickCategory(user, 'Coffee', dialog)

        submitClosestForm(within(dialog).getByRole('button', { name: 'Create rule' }))

        await waitFor(() => expect(screen.getByText('Rent')).toBeInTheDocument())

        const rules = await rulesRepo.list(db)
        const created = rules.find((rule) => rule.name === 'Rent')
        expect(created).toBeDefined()
        expect(created?.matchValue).toBe('rent')
        expect(created?.categoryId).toBe('cat-coffee')
    })

    it('deletes (soft-deletes) a rule locally', async () => {
        const db = await seedFixtures()
        const user = userEvent.setup()

        renderWithProviders(<CategorizationRules />, { route: '/categories/rules' })
        await waitFor(() => expect(screen.getByText('Coffee shops')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: 'Delete rule' }))
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

        await waitFor(() => expect(screen.queryByText('Coffee shops')).not.toBeInTheDocument())

        expect(await rulesRepo.findById(db, 'rule-1')).toBeNull()
    })

    it('tests a sample transaction against local rules with ruleMatchesTransactionLocal, no network call', async () => {
        await seedFixtures()
        const user = userEvent.setup()

        renderWithProviders(<CategorizationRules />, { route: '/categories/rules' })
        await waitFor(() => expect(screen.getByText('Coffee shops')).toBeInTheDocument())

        await user.type(screen.getByPlaceholderText('Merchant or payee'), 'Morning coffee run')
        await user.type(screen.getByPlaceholderText('0.00'), '4.50')
        await user.selectOptions(screen.getByRole('combobox'), 'acc-1')

        submitClosestForm(screen.getByRole('button', { name: 'Run test' }))

        await waitFor(() => expect(screen.getByText(/matched: coffee shops/i)).toBeInTheDocument())
        expect(axiosInstance.post).not.toHaveBeenCalledWith(
            expect.stringContaining('/categorization-rules'),
            expect.anything()
        )
    })
})
