import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor, within, userEvent, fireEvent } from '../../../test/test-utils'
import Transactions from '../Transactions'
import axiosInstance from '../../../utils/axiosInstance'
import { setCachedUser } from '../../../offline/cachedUser'
import { storeOfflineGrant } from '../../../offline/offlineGrant'
import { createTestOfflineGrant } from '../../../test/offlineGrantFixture'
import { getLocalDb, resetLocalDbForTests } from '../../../db/localDbInstance'
import { Repository } from '../../../db/repositories/Repository'
import type { LocalAccount, LocalCategory, LocalTransaction } from '../../../domain/types'
import type { User } from '../../../types/api'

// This page's local-first data layer lives in `../hooks/useTransactionsData.ts` (plus the sibling
// `useAccountsData`/`useCategoriesData`/`useTagsData` hooks for form lookups) - branches on
// `isLocalFirstEnabled()` (read from `import.meta.env.VITE_LOCAL_FIRST`). `vi.stubEnv` works
// against `import.meta.env` under vitest (confirmed by `Accounts.test.tsx`/`Home.test.tsx` in this
// same directory, which use the identical pattern), so no module mock is needed for the flag itself.

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
const categoriesRepo = new Repository<LocalCategory & { isDefault: boolean; sortOrder: number }>('categories')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

const CHECKING_ID = 'acc-checking'
const SAVINGS_ID = 'acc-savings'
const FOOD_CATEGORY_ID = 'cat-food'
const OTHER_CATEGORY_ID = 'cat-other'

const nowIso = () => new Date().toISOString()

const seedAccountsAndCategories = async () => {
    const db = await getLocalDb()
    await accountsRepo.upsertFromServer(db, [
        {
            _id: CHECKING_ID,
            updatedAt: nowIso(),
            userId: 'user1',
            name: 'Checking',
            type: 'checking',
            currency: 'USD',
            currentBalance: 1000,
            openingBalance: 1000,
            isDefault: true,
            isArchived: false,
        },
        {
            _id: SAVINGS_ID,
            updatedAt: nowIso(),
            userId: 'user1',
            name: 'Savings',
            type: 'savings',
            currency: 'USD',
            currentBalance: 500,
            openingBalance: 500,
            isDefault: false,
            isArchived: false,
        },
    ])
    await categoriesRepo.upsertFromServer(db, [
        {
            _id: FOOD_CATEGORY_ID,
            updatedAt: nowIso(),
            userId: null,
            masterCategoryId: null,
            name: 'Food',
            isDefault: false,
            sortOrder: 0,
            isArchived: false,
        },
        {
            _id: OTHER_CATEGORY_ID,
            updatedAt: nowIso(),
            userId: null,
            masterCategoryId: null,
            name: 'Other',
            isDefault: false,
            sortOrder: 1,
            isArchived: false,
        },
    ])
}

const seedTransaction = async (overrides: Partial<LocalTransaction> = {}) => {
    const db = await getLocalDb()
    const _id = overrides._id ?? `tx-${Math.random().toString(16).slice(2)}`
    await transactionsRepo.upsertFromServer(db, [
        {
            _id,
            updatedAt: nowIso(),
            createdAt: nowIso(),
            userId: 'user1',
            accountId: CHECKING_ID,
            categoryId: FOOD_CATEGORY_ID,
            type: 'expense',
            status: 'posted',
            amount: 1500,
            title: 'Groceries',
            date: '2026-01-05T00:00:00.000Z',
            clearedStatus: 'pending',
            splitTransactionId: null,
            ...overrides,
        },
    ])
    return _id
}

beforeEach(async () => {
    vi.stubEnv('VITE_LOCAL_FIRST', 'true')
    resetLocalDbForTests()
    localStorage.removeItem('spndr_active_workspace_id')
    setCachedUser(mockUser)
    await storeOfflineGrant(await createTestOfflineGrant(mockUser._id))
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })
    vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Network Error'))
    vi.mocked(axiosInstance.post).mockRejectedValue(new Error('Network Error'))
    vi.mocked(axiosInstance.put).mockRejectedValue(new Error('Network Error'))
    vi.mocked(axiosInstance.patch).mockRejectedValue(new Error('Network Error'))
    vi.mocked(axiosInstance.delete).mockRejectedValue(new Error('Network Error'))
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
})

describe('Transactions (local-first)', () => {
    it('renders transactions read from the local store', async () => {
        await seedAccountsAndCategories()
        await seedTransaction({ title: 'Groceries' })

        renderWithProviders(<Transactions />, { route: '/transactions' })

        await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument())
        expect(axiosInstance.get).not.toHaveBeenCalledWith(expect.stringContaining('/transactions'), expect.anything())
    })

    it('filters the local list by search keyword', async () => {
        await seedAccountsAndCategories()
        await seedTransaction({ _id: 'tx-groceries', title: 'Groceries' })
        await seedTransaction({ _id: 'tx-rent', title: 'Rent payment', amount: 90000 })
        const user = userEvent.setup()

        renderWithProviders(<Transactions />, { route: '/transactions' })
        await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument())
        expect(screen.getByText('Rent payment')).toBeInTheDocument()

        await user.type(screen.getByPlaceholderText(/search by title/i), 'rent')
        await user.click(screen.getByRole('button', { name: /^search$/i }))

        await waitFor(() => expect(screen.queryByText('Groceries')).not.toBeInTheDocument())
        expect(screen.getByText('Rent payment')).toBeInTheDocument()
    })

    it('filters the local list by type tab', async () => {
        await seedAccountsAndCategories()
        await seedTransaction({ _id: 'tx-expense', title: 'Groceries', type: 'expense' })
        await seedTransaction({
            _id: 'tx-income',
            title: 'Paycheck',
            type: 'income',
            amount: 200000,
            categoryId: FOOD_CATEGORY_ID,
        })
        const user = userEvent.setup()

        renderWithProviders(<Transactions />, { route: '/transactions' })
        await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument())
        expect(screen.getByText('Paycheck')).toBeInTheDocument()

        // Two buttons named "Income" exist - the header's "add income" action and the filter tab.
        // The filter tab is the plain-text one with no icon-derived extra name; disambiguate by
        // scoping to the type-tab row (the first `.flex.flex-wrap.gap-2` container on the page).
        const typeTabRow = document.querySelector('.card .flex.flex-wrap.gap-2') as HTMLElement
        await user.click(within(typeTabRow).getByRole('button', { name: 'Income' }))

        await waitFor(() => expect(screen.queryByText('Groceries')).not.toBeInTheDocument())
        expect(screen.getByText('Paycheck')).toBeInTheDocument()
    })

    // X7 (Gate G3): the type-filter tabs style the active tab with classes only - no aria-pressed -
    // so a screen-reader user can't tell which filter is currently applied. Acceptance spec for X7.
    it('exposes the active type-filter tab via aria-pressed', async () => {
        await seedAccountsAndCategories()
        await seedTransaction({ _id: 'tx-expense', title: 'Groceries', type: 'expense' })
        const user = userEvent.setup()

        renderWithProviders(<Transactions />, { route: '/transactions' })
        await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument())

        const typeTabRow = document.querySelector('.card .flex.flex-wrap.gap-2') as HTMLElement
        const allTab = within(typeTabRow).getByRole('button', { name: 'All' })
        const incomeTab = within(typeTabRow).getByRole('button', { name: 'Income' })

        expect(allTab).toHaveAttribute('aria-pressed', 'true')
        expect(incomeTab).toHaveAttribute('aria-pressed', 'false')

        await user.click(incomeTab)

        expect(incomeTab).toHaveAttribute('aria-pressed', 'true')
        expect(allTab).toHaveAttribute('aria-pressed', 'false')
    })

    it('creates a plain expense through the local store and recomputes the account balance', async () => {
        await seedAccountsAndCategories()
        const user = userEvent.setup()

        renderWithProviders(<Transactions />, { route: '/transactions' })
        // Two buttons named "Expense" exist - the header's "add expense" action (renders first in
        // the DOM) and the type-filter tab further down the page.
        await waitFor(() => expect(screen.getAllByRole('button', { name: /^expense$/i }).length).toBeGreaterThan(0))

        await user.click(screen.getAllByRole('button', { name: /^expense$/i })[0])
        const dialog = await screen.findByRole('dialog', { name: /add expense/i })

        await user.type(within(dialog).getByPlaceholderText('Groceries, rent, etc.'), 'Coffee run')
        await user.clear(within(dialog).getByPlaceholderText('0.00'))
        await user.type(within(dialog).getByPlaceholderText('0.00'), '25')

        // Comboboxes in DOM order for a plain (non-split) create form: Type, Account, Category.
        // Select both explicitly rather than relying on the account defaulting, since the default
        // depends on the (async, if slightly slower to settle) accounts lookup having resolved.
        const combos = within(dialog).getAllByRole('combobox')
        await user.selectOptions(combos[1], CHECKING_ID)
        await user.selectOptions(combos[2], FOOD_CATEGORY_ID)

        // `userEvent.click` on the submit button does not reliably dispatch a native `submit`
        // event against the form in this test environment; submit the form directly instead
        // (the same approach RTL recommends for form submission).
        fireEvent.submit(dialog.querySelector('form') as HTMLFormElement)

        await waitFor(() => expect(screen.getByText('Coffee run')).toBeInTheDocument())

        const db = await getLocalDb()
        const created = (await transactionsRepo.list(db)).find((tx) => tx.title === 'Coffee run')
        expect(created).toBeDefined()
        expect(created?.amount).toBe(2500)
        expect(created?.accountId).toBe(CHECKING_ID)

        const account = await accountsRepo.findById(db, CHECKING_ID)
        expect(account?.currentBalance).toBe(975)
    })

    it('creates a transfer through the local store and updates both account balances in the correct direction', async () => {
        await seedAccountsAndCategories()
        const user = userEvent.setup()

        renderWithProviders(<Transactions />, { route: '/transactions' })
        // Two buttons named "Transfer" exist - the header's "create transfer" action (renders
        // first in the DOM) and the type-filter tab further down the page.
        await waitFor(() => expect(screen.getAllByRole('button', { name: /^transfer$/i }).length).toBeGreaterThan(0))

        await user.click(screen.getAllByRole('button', { name: /^transfer$/i })[0])
        const dialog = await screen.findByRole('dialog', { name: /transfer between accounts/i })

        await user.type(
            within(dialog).getByPlaceholderText('Move to savings, pay credit card, etc.'),
            'Move to savings'
        )
        await user.clear(within(dialog).getByPlaceholderText('0.00'))
        await user.type(within(dialog).getByPlaceholderText('0.00'), '200')

        // Comboboxes in DOM order: From account, To account. Select both explicitly rather than
        // relying on the accounts-lookup-derived defaults having resolved by click time.
        const combos = within(dialog).getAllByRole('combobox')
        await user.selectOptions(combos[0], CHECKING_ID)
        await user.selectOptions(combos[1], SAVINGS_ID)

        fireEvent.submit(dialog.querySelector('form') as HTMLFormElement)

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

        const db = await getLocalDb()
        const checkingAccount = await accountsRepo.findById(db, CHECKING_ID)
        const savingsAccount = await accountsRepo.findById(db, SAVINGS_ID)
        expect(checkingAccount?.currentBalance).toBe(800)
        expect(savingsAccount?.currentBalance).toBe(700)

        const transferLegs = (await transactionsRepo.list(db)).filter((tx) => tx.type === 'transfer')
        expect(transferLegs).toHaveLength(2)
        expect(transferLegs[0].transferPairId).toBe(transferLegs[1]._id)
        expect(transferLegs[1].transferPairId).toBe(transferLegs[0]._id)
    })

    it('bulk-deletes transactions across two different accounts and recomputes both balances', async () => {
        await seedAccountsAndCategories()
        await seedTransaction({ _id: 'tx-checking', title: 'Checking expense', accountId: CHECKING_ID, amount: 10000 })
        await seedTransaction({ _id: 'tx-savings', title: 'Savings expense', accountId: SAVINGS_ID, amount: 5000 })
        const user = userEvent.setup()

        renderWithProviders(<Transactions />, { route: '/transactions' })
        await waitFor(() => expect(screen.getByText('Checking expense')).toBeInTheDocument())
        expect(screen.getByText('Savings expense')).toBeInTheDocument()

        await user.click(screen.getByRole('checkbox', { name: 'Select Checking expense' }))
        await user.click(screen.getByRole('checkbox', { name: 'Select Savings expense' }))

        await user.click(screen.getByRole('button', { name: /delete selected/i }))
        const dialog = await screen.findByRole('dialog', { name: /delete selected transactions/i })
        await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))

        await waitFor(() => expect(screen.queryByText('Checking expense')).not.toBeInTheDocument())
        expect(screen.queryByText('Savings expense')).not.toBeInTheDocument()

        const db = await getLocalDb()
        const checkingAccount = await accountsRepo.findById(db, CHECKING_ID)
        const savingsAccount = await accountsRepo.findById(db, SAVINGS_ID)
        // Both seeded expenses are removed - each account's balance recomputes back to its
        // (fixture) opening balance since no other transactions remain.
        expect(checkingAccount?.currentBalance).toBe(1000)
        expect(savingsAccount?.currentBalance).toBe(500)
    })

    // T4: gap-fill - the suite above covers create (plain + transfer) and bulk delete, but not a
    // single-row edit or a single-row delete, and no client-validation error path.
    it('edits an existing transaction through the local store and recomputes the account balance', async () => {
        await seedAccountsAndCategories()
        const txId = await seedTransaction({ title: 'Groceries', amount: 1500 })
        const user = userEvent.setup()

        renderWithProviders(<Transactions />, { route: '/transactions' })
        await waitFor(() => expect(screen.getByText('Groceries')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: 'Edit transaction' }))
        const dialog = await screen.findByRole('dialog', { name: 'Edit transaction' })

        const titleInput = within(dialog).getByPlaceholderText('Groceries, rent, etc.')
        await user.clear(titleInput)
        await user.type(titleInput, 'Weekly shop')

        const amountInput = within(dialog).getByPlaceholderText('0.00')
        await user.clear(amountInput)
        await user.type(amountInput, '20')

        fireEvent.submit(dialog.querySelector('form') as HTMLFormElement)

        await waitFor(() => expect(screen.getByText('Weekly shop')).toBeInTheDocument())
        expect(screen.queryByText('Groceries')).not.toBeInTheDocument()

        const db = await getLocalDb()
        const updated = await transactionsRepo.findById(db, txId)
        expect(updated?.title).toBe('Weekly shop')
        expect(updated?.amount).toBe(2000)

        const account = await accountsRepo.findById(db, CHECKING_ID)
        expect(account?.currentBalance).toBe(980)
    })

    it('deletes a single transaction via the row action and reverses the account balance', async () => {
        await seedAccountsAndCategories()
        await seedTransaction({ _id: 'tx-only', title: 'One-off charge', amount: 3000 })
        const user = userEvent.setup()

        renderWithProviders(<Transactions />, { route: '/transactions' })
        await waitFor(() => expect(screen.getByText('One-off charge')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: 'Delete transaction' }))
        const dialog = await screen.findByRole('dialog', { name: 'Delete transaction' })
        await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))

        await waitFor(() => expect(screen.queryByText('One-off charge')).not.toBeInTheDocument())

        const db = await getLocalDb()
        expect(await transactionsRepo.findById(db, 'tx-only')).toBeNull()
        const account = await accountsRepo.findById(db, CHECKING_ID)
        expect(account?.currentBalance).toBe(1000)
    })

    it('blocks submit and writes nothing when required fields are missing', async () => {
        await seedAccountsAndCategories()
        const user = userEvent.setup()

        renderWithProviders(<Transactions />, { route: '/transactions' })
        await waitFor(() => expect(screen.getAllByRole('button', { name: /^expense$/i }).length).toBeGreaterThan(0))

        await user.click(screen.getAllByRole('button', { name: /^expense$/i })[0])
        const dialog = await screen.findByRole('dialog', { name: /add expense/i })

        // Title and amount are left blank - client validation should block submit before any
        // local-store write happens.
        fireEvent.submit(dialog.querySelector('form') as HTMLFormElement)

        expect(screen.getByRole('dialog')).toBeInTheDocument()
        const db = await getLocalDb()
        expect(await transactionsRepo.list(db)).toHaveLength(0)
    })
})
