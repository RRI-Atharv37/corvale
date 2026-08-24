import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor, within, userEvent, fireEvent } from '../../../test/test-utils'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'
import { resetLocalDbForTests, getLocalDb } from '../../../db/localDbInstance'
import { Repository } from '../../../db/repositories/Repository'
import type { LocalAccount, LocalBudget, LocalCategory, LocalTransaction } from '../../../domain/types'
import type { User } from '../../../types/api'
import Budgets from '../Budgets'

// This suite forces the local-first branch on. `vi.stubEnv('VITE_LOCAL_FIRST', 'true')` does not
// reliably flip `import.meta.env.VITE_LOCAL_FIRST` under this project's vitest setup (the value is
// resolved once via Vite's env handling rather than re-read from `process.env` per call), so the
// flag module is mocked directly instead - guaranteed to work regardless of that behavior.
vi.mock('../../../utils/localFirstFlag', () => ({
    isLocalFirstEnabled: () => true,
}))

vi.mock('../../../utils/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    },
}))

const mockUser: User = {
    _id: 'user1',
    fullName: 'Jamie Rivera',
    email: 'jamie@example.com',
    preferredCurrency: 'USD',
    timezone: 'UTC',
}

const accountsRepo = new Repository<LocalAccount>('accounts')
const categoriesRepo = new Repository<LocalCategory>('categories')
const budgetsRepo = new Repository<LocalBudget>('budgets')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

const currentMonthPeriod = () => {
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    return {
        periodStart: `${year}-${month}-01T00:00:00.000Z`,
        periodEnd: `${year}-${month}-28T23:59:59.999Z`,
        midMonth: `${year}-${month}-15T12:00:00.000Z`,
    }
}

/** Seeds an account, a master category, and one budget with a posted expense that counts toward
 * it - the same shape `domain/__tests__/localDomainParity.test.ts` uses for budget progress. */
const seedBudgetWithProgress = async () => {
    const db = await getLocalDb()
    const nowIso = new Date().toISOString()
    const { periodStart, periodEnd, midMonth } = currentMonthPeriod()

    await accountsRepo.upsertFromServer(db, [
        {
            _id: 'acc1',
            updatedAt: nowIso,
            userId: 'user1',
            workspaceId: null,
            name: 'Checking',
            type: 'checking',
            currency: 'USD',
            currentBalance: 1000,
            isArchived: false,
        },
    ])
    await categoriesRepo.upsertFromServer(db, [
        {
            _id: 'cat1',
            updatedAt: nowIso,
            userId: 'user1',
            masterCategoryId: null,
            name: 'Food',
            isArchived: false,
        },
    ])
    await budgetsRepo.upsertFromServer(db, [
        {
            _id: 'budget1',
            updatedAt: nowIso,
            userId: 'user1',
            workspaceId: null,
            name: 'Food budget',
            periodType: 'monthly',
            periodStart,
            periodEnd,
            categoryId: 'cat1',
            amount: 100000, // $1000 in minor units
            currency: 'USD',
            rollover: false,
            accountIds: [],
            isArchived: false,
        } as LocalBudget,
    ])
    await transactionsRepo.upsertFromServer(db, [
        {
            _id: 'tx1',
            updatedAt: nowIso,
            userId: 'user1',
            accountId: 'acc1',
            categoryId: 'cat1',
            type: 'expense',
            status: 'posted',
            amount: 11000, // $110 in minor units
            title: 'Groceries',
            date: midMonth,
            splitTransactionId: null,
        },
    ])

    return db
}

beforeEach(() => {
    resetLocalDbForTests()
    // `POST /auth/refresh` (restoreSession, S16/SEC-18 - the access token lives in memory only
    // and is restored via the httpOnly refresh cookie, not a stored token) and `GET /workspaces`
    // (WorkspaceProvider) fire in the local-first branch - everything else is read from the
    // local store.
    vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
        if (url === API_PATHS.AUTH.REFRESH) {
            return { success: true, data: { token: 'test-token', user: mockUser, offlineGrant: 'unused-online' } }
        }
        return { success: true, data: [] }
    })
    vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: [] })
})

describe('Budgets page (local-first)', () => {
    it('renders a seeded budget with its computed progress', async () => {
        await seedBudgetWithProgress()

        renderWithProviders(<Budgets />)

        await waitFor(() => expect(screen.getByText('Food budget')).toBeInTheDocument())

        expect(screen.getByText('Food')).toBeInTheDocument()
        expect(screen.getByText(/\$110\.00 spent/)).toBeInTheDocument()
        expect(screen.getByText(/\$890\.00 left/)).toBeInTheDocument()
        expect(screen.getByText('11% used')).toBeInTheDocument()
    })

    it('creates a new budget through the form and persists it to the local store', async () => {
        const db = await seedBudgetWithProgress()
        const user = userEvent.setup()

        renderWithProviders(<Budgets />)

        await waitFor(() => expect(screen.getByText('Food budget')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: 'Create budget' }))
        const dialog = await screen.findByRole('dialog')

        await user.type(within(dialog).getByPlaceholderText('Groceries, Monthly spending, etc.'), 'Rent')
        await user.type(within(dialog).getByPlaceholderText('500.00'), '750')

        // happy-dom's HTML5 constraint validation reads a controlled `<input type="number">`'s
        // `value` ATTRIBUTE rather than its live property, so it wrongly reports the amount field
        // as empty/invalid and silently blocks the native submit a button click would trigger.
        // Submitting the form directly (as a real browser would once validation passes) exercises
        // the same `onSubmit={handleCreate}` handler without depending on that broken check.
        const form = dialog.querySelector('form')
        if (!form) throw new Error('Create budget form not found')
        fireEvent.submit(form)

        await waitFor(() => expect(screen.getByText('Rent')).toBeInTheDocument())

        const budgets = await budgetsRepo.list(db)
        expect(budgets).toHaveLength(2)
        const created = budgets.find((budget) => budget.name === 'Rent')
        expect(created).toBeDefined()
        expect(created?.amount).toBe(75000) // stored in minor units
        expect(created?.isArchived).toBe(false)
    })

    it('archives a budget via an isArchived update rather than deleting the row', async () => {
        const db = await seedBudgetWithProgress()
        const user = userEvent.setup()

        renderWithProviders(<Budgets />)

        await waitFor(() => expect(screen.getByText('Food budget')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: 'Archive budget' }))
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: 'Archive' }))

        await waitFor(() => expect(screen.queryByText('Food budget')).not.toBeInTheDocument())

        const budget = await budgetsRepo.findById(db, 'budget1')
        expect(budget).not.toBeNull()
        expect(budget?.isArchived).toBe(true)
    })
})
