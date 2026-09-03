import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, waitFor, within, userEvent, fireEvent } from '@/test/test-utils'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { resetLocalDbForTests, getLocalDb } from '@platform/db/localDbInstance'
import { Repository } from '@platform/db/repositories/Repository'
import type { LocalSavingsGoal } from '@domain/types'
import type { User } from '@lib/types/api'
import SavingsGoals from '../SavingsGoalsPage'

// This suite forces the local-first branch on. `vi.stubEnv('VITE_LOCAL_FIRST', 'true')` does not
// reliably flip `import.meta.env.VITE_LOCAL_FIRST` under this project's vitest setup (the value is
// resolved once via Vite's env handling rather than re-read from `process.env` per call), so the
// flag module is mocked directly instead - guaranteed to work regardless of that behavior.
vi.mock('@lib/localFirstFlag', () => ({
    isLocalFirstEnabled: () => true,
}))

vi.mock('@lib/axiosInstance', () => ({
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

const goalsRepo = new Repository<LocalSavingsGoal>('savingsGoals')

/** Seeds one active goal with a partial balance - matches the fixture shape used by
 * `domain/__tests__/localDomainParity.test.ts` for savings goal progress. */
const seedGoal = async () => {
    const db = await getLocalDb()
    const nowIso = new Date().toISOString()

    await goalsRepo.upsertFromServer(db, [
        {
            _id: 'goal1',
            updatedAt: nowIso,
            userId: 'user1',
            workspaceId: null,
            name: 'Vacation fund',
            targetAmount: 100000, // $1000 in minor units
            currentAmount: 25000, // $250 in minor units
            currency: 'USD',
            targetDate: null,
            status: 'active',
            accountId: null,
            autoContribution: { enabled: false, amount: 0, interval: 'monthly' },
        } as LocalSavingsGoal,
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

describe('SavingsGoals page (local-first)', () => {
    it('renders a seeded goal with its computed progress', async () => {
        await seedGoal()

        renderWithProviders(<SavingsGoals />)

        await waitFor(() => expect(screen.getByText('Vacation fund')).toBeInTheDocument())

        expect(screen.getByText(/\$250\.00 saved/)).toBeInTheDocument()
        expect(screen.getByText(/\$750\.00 to go/)).toBeInTheDocument()
        expect(screen.getByText('25% complete')).toBeInTheDocument()
    })

    it('shows a standing note that projected completion dates are estimates (V2)', async () => {
        await seedGoal()

        renderWithProviders(<SavingsGoals />)

        const note = await screen.findByRole('note')
        expect(note).toHaveTextContent(/projected completion dates assume your recent contribution rate/i)
    })

    it('creates a new savings goal through the form and persists it to the local store', async () => {
        const db = await seedGoal()
        const user = userEvent.setup()

        renderWithProviders(<SavingsGoals />)

        await waitFor(() => expect(screen.getByText('Vacation fund')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: 'Create goal' }))
        const dialog = await screen.findByRole('dialog')

        await user.type(
            within(dialog).getByPlaceholderText('Emergency fund, New laptop, etc.'),
            'New laptop'
        )
        await user.type(within(dialog).getByPlaceholderText('1000.00'), '1500')

        // happy-dom's HTML5 constraint validation reads a controlled `<input type="number">`'s
        // `value` ATTRIBUTE rather than its live property, so it wrongly reports the target-amount
        // field as empty/invalid and silently blocks the native submit a button click would
        // trigger. Submitting the form directly (as a real browser would once validation passes)
        // exercises the same `onSubmit={handleCreate}` handler without depending on that broken
        // check.
        const form = dialog.querySelector('form')
        if (!form) throw new Error('Create goal form not found')
        fireEvent.submit(form)

        await waitFor(() => expect(screen.getByText('New laptop')).toBeInTheDocument())

        const goals = await goalsRepo.list(db)
        expect(goals).toHaveLength(2)
        const created = goals.find((goal) => goal.name === 'New laptop')
        expect(created).toBeDefined()
        expect(created?.targetAmount).toBe(150000) // stored in minor units
        expect(created?.currentAmount).toBe(0)
        expect(created?.status).toBe('active')
    })

    it('archives a goal via a status update rather than deleting the row', async () => {
        const db = await seedGoal()
        const user = userEvent.setup()

        renderWithProviders(<SavingsGoals />)

        await waitFor(() => expect(screen.getByText('Vacation fund')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: 'Archive goal' }))
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: 'Archive' }))

        await waitFor(() => expect(screen.queryByText('Vacation fund')).not.toBeInTheDocument())

        const goal = await goalsRepo.findById(db, 'goal1')
        expect(goal).not.toBeNull()
        expect(goal?.status).toBe('archived')
    })
})
