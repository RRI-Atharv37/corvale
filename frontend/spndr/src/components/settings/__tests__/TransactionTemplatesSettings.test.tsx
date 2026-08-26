import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor, within, userEvent, fireEvent } from '../../../test/test-utils'
import TransactionTemplatesSettings from '../TransactionTemplatesSettings'
import axiosInstance from '../../../utils/axiosInstance'
import { setCachedUser } from '../../../offline/cachedUser'
import { storeOfflineGrant } from '../../../offline/offlineGrant'
import { createTestOfflineGrant } from '../../../test/offlineGrantFixture'
import { getLocalDb, resetLocalDbForTests } from '../../../db/localDbInstance'
import { Repository } from '../../../db/repositories/Repository'
import type { LocalAccount, LocalCategory, LocalTransactionTemplate } from '../../../domain/types'
import type { User } from '../../../types/api'

// Sprint 13.9: proves TransactionTemplatesSettings reads and writes through the local SQLite store
// (a real soft-delete entity like Tag, unlike RecurringRule's archive-flag translation) when
// VITE_LOCAL_FIRST is on.

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
const templatesRepo = new Repository<LocalTransactionTemplate>('transactionTemplates')

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
            name: 'Food',
            isArchived: false,
        },
    ])
    await templatesRepo.upsertFromServer(db, [
        {
            _id: 'tmpl-1',
            updatedAt: new Date().toISOString(),
            userId: 'user1',
            name: 'Coffee',
            type: 'expense',
            amount: 500,
            accountId: 'acc-1',
            categoryId: 'cat-1',
            tags: [],
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

describe('TransactionTemplatesSettings (local-first)', () => {
    it('renders a seeded template with its amount converted from minor units', async () => {
        await seedFixtures()

        renderWithProviders(<TransactionTemplatesSettings />)

        await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())
        expect(screen.getByText(/\$5\.00/)).toBeInTheDocument()
        expect(axiosInstance.get).not.toHaveBeenCalledWith(
            expect.stringContaining('/transaction-templates'),
            expect.anything()
        )
    })

    it('creates a new template locally, stored in minor units', async () => {
        const db = await seedFixtures()
        const user = userEvent.setup()

        renderWithProviders(<TransactionTemplatesSettings />)
        await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: /add/i }))

        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByPlaceholderText('Coffee, Rent, Paycheck...'), 'Paycheck')
        await user.type(within(dialog).getByRole('spinbutton'), '2000')

        const comboboxes = within(dialog).getAllByRole('combobox')
        // Order: TypeSelect, AccountPicker, CategoryPicker.
        await user.selectOptions(comboboxes[1], 'acc-1')
        await user.selectOptions(comboboxes[2], 'cat-1')

        submitClosestForm(within(dialog).getByRole('button', { name: 'Create template' }))

        await waitFor(() => expect(screen.getByText('Paycheck')).toBeInTheDocument())

        const templates = await templatesRepo.list(db)
        const created = templates.find((template) => template.name === 'Paycheck')
        expect(created).toBeDefined()
        expect(created?.amount).toBe(200000)
    })

    it('deletes (soft-deletes) a template locally', async () => {
        const db = await seedFixtures()
        const user = userEvent.setup()

        renderWithProviders(<TransactionTemplatesSettings />)
        await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: 'Delete Coffee' }))
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

        await waitFor(() => expect(screen.queryByText('Coffee')).not.toBeInTheDocument())

        expect(await templatesRepo.findById(db, 'tmpl-1')).toBeNull()
    })
})
