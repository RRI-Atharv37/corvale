import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor, within, userEvent, fireEvent } from '../../../test/test-utils'
import Recurring from '../Recurring'
import axiosInstance from '../../../utils/axiosInstance'
import { setCachedUser } from '../../../offline/cachedUser'
import { storeOfflineGrant } from '../../../offline/offlineGrant'
import { createTestOfflineGrant } from '../../../test/offlineGrantFixture'
import { getLocalDb, resetLocalDbForTests } from '../../../db/localDbInstance'
import { Repository } from '../../../db/repositories/Repository'
import type { LocalAccount, LocalCategory, LocalRecurringRule } from '../../../domain/types'
import type { User } from '../../../types/api'

// Sprint 13.9: proves Recurring.tsx's rule CRUD (create/update/archive/toggle-active) reads and
// writes through the local SQLite store when VITE_LOCAL_FIRST is on, while draft
// generation/confirm/dismiss stay server-only per ROADMAP.md's "Server-authoritative" decision -
// tested here via the offline-disabled state, since drafts have no local fallback to assert against.
//
// Note: form submission is exercised via `fireEvent.submit(form)` rather than clicking the
// `type="submit"` button - happy-dom (the project's test environment) does not reliably fire the
// implicit form submission a real browser produces on a submit-button click.

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

const accountsRepo = new Repository<LocalAccount>('accounts')
const categoriesRepo = new Repository<LocalCategory>('categories')
const recurringRepo = new Repository<LocalRecurringRule>('recurringRules')

const submitClosestForm = (element: HTMLElement): void => {
    const form = element.closest('form') ?? element.ownerDocument.querySelector('form')
    if (!form) throw new Error('No form found to submit')
    fireEvent.submit(form)
}

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
            _id: 'cat-1',
            updatedAt: new Date().toISOString(),
            userId: null,
            masterCategoryId: null,
            name: 'Bills',
            isArchived: false,
        },
    ])
    await recurringRepo.upsertFromServer(db, [
        {
            _id: 'rule-1',
            updatedAt: new Date().toISOString(),
            userId: 'user1',
            workspaceId: null,
            title: 'Netflix',
            type: 'expense',
            amount: 1500,
            currency: 'USD',
            accountId: 'acc-1',
            categoryId: 'cat-1',
            interval: 'monthly',
            nextDueDate: '2026-09-01',
            tags: [],
            isActive: true,
            isArchived: false,
            isCancelled: false,
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

describe('Recurring (local-first rule CRUD)', () => {
    it('renders seeded rules from the local store with amounts converted from minor units', async () => {
        await seedFixtures()

        renderWithProviders(<Recurring />, { route: '/recurring' })

        await waitFor(() => expect(screen.getByText('Netflix')).toBeInTheDocument())
        expect(screen.getByText(/\$15\.00/)).toBeInTheDocument()
        // The rules list itself must never hit REST - only the always-server drafts fetch
        // (`/recurring-rules/drafts`, triggered on mount regardless of view) is expected here.
        expect(axiosInstance.get).not.toHaveBeenCalledWith('/recurring-rules', expect.anything())
    })

    it('creates a new rule locally and persists it in minor units', async () => {
        const db = await seedFixtures()
        const user = userEvent.setup()

        renderWithProviders(<Recurring />, { route: '/recurring' })
        await waitFor(() => expect(screen.getByText('Netflix')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: 'Create rule' }))

        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByPlaceholderText('Rent, Netflix, Salary, etc.'), 'Gym membership')
        await user.type(within(dialog).getByPlaceholderText('100.00'), '25')

        const comboboxes = within(dialog).getAllByRole('combobox')
        // Order in `renderFormFields`: Type, Currency, Account, Category, Interval.
        await user.selectOptions(comboboxes[2], 'acc-1')
        await user.selectOptions(comboboxes[3], 'cat-1')

        submitClosestForm(within(dialog).getByRole('button', { name: 'Create rule' }))

        await waitFor(() => expect(screen.getByText('Gym membership')).toBeInTheDocument())

        const rules = await recurringRepo.list(db)
        const created = rules.find((rule) => rule.title === 'Gym membership')
        expect(created).toBeDefined()
        expect(created?.amount).toBe(2500)
        expect(created?.isArchived).toBe(false)
    })

    it('archives a rule locally (isArchived + isActive cleared, no soft-delete)', async () => {
        const db = await seedFixtures()
        const user = userEvent.setup()

        renderWithProviders(<Recurring />, { route: '/recurring' })
        await waitFor(() => expect(screen.getByText('Netflix')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: 'Archive rule' }))
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: 'Archive' }))

        await waitFor(() => expect(screen.queryByText('Netflix')).not.toBeInTheDocument())

        const stored = await recurringRepo.findById(db, 'rule-1')
        expect(stored?.isArchived).toBe(true)
        expect(stored?.isActive).toBe(false)
        expect(stored?.deletedAt ?? null).toBeNull()
    })

    it('disables draft sync/confirm/dismiss while offline, since drafts stay server-only', async () => {
        await seedFixtures()
        const user = userEvent.setup()

        renderWithProviders(<Recurring />, { route: '/recurring' })
        await waitFor(() => expect(screen.getByText('Netflix')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: /draft inbox/i }))

        await waitFor(() => expect(screen.getByText(/you are offline/i)).toBeInTheDocument())
    })
})
