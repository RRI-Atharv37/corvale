import { useCallback } from 'react'
import { fromMinorUnits, toMinorUnits } from '@shared/money'
import { isAutoContributionDuePure } from '@shared/savingsGoals'
import { DEFAULT_TIMEZONE } from '@shared/timezone'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { useAsyncData } from '@/app/hooks/useAsyncData'
import { useLocalQuery } from '@platform/db/useLocalQuery'
import { getLocalDb } from '@platform/db/localDbInstance'
import { tableInvalidationBus } from '@lib/tableInvalidationBus'
import { Repository } from '@platform/db/repositories/Repository'
import { generateLocalObjectId } from '@platform/db/generateLocalId'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import { listLocalSavingsGoalsWithProgress } from '@domain/savingsGoalProgress'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'
import { useUser } from '@/app/providers/useUser'
import { useOnlineStatus } from '@platform/offline/useOnlineStatus'
import { syncNow } from '@platform/sync/syncEngine'
import type {
    Account,
    ApiResponse,
    AutoContributionInterval,
    ContributionType,
    SavingsGoal,
    SavingsGoalContribution,
} from '@lib/types/api'
import type { LocalAccount, LocalSavingsGoal, LocalSavingsGoalContribution } from '@domain/types'
import type { LocalDb } from '@platform/db/LocalDb'

/** `LocalSavingsGoal`/`LocalSavingsGoalContribution` (domain/types.ts) are missing a few fields
 * that round-trip fine through the JSON `data` blob (Repository stores the full doc) but aren't
 * declared on the shared local-domain type yet - `currency`/`accountId` on the goal (the
 * server document has both; only `accountId` is a promoted SQL column per
 * `db/repositories/Repository.ts` `PROMOTED_COLUMNS`), `type`/`note` on the contribution. Widened
 * here rather than touching `domain/types.ts`, which Sprint 13.5 infra owns. */
interface LocalSavingsGoalRecord extends LocalSavingsGoal {
    currency: string
    accountId?: string | null
}

interface LocalSavingsGoalContributionRecord extends LocalSavingsGoalContribution {
    type: ContributionType
    note?: string
}

const goalsRepo = new Repository<LocalSavingsGoalRecord>('savingsGoals')
const contributionsRepo = new Repository<LocalSavingsGoalContributionRecord>('savingsGoalContributions')
const accountsRepo = new Repository<LocalAccount>('accounts')

export type GoalView = 'active' | 'completed' | 'archived'

/** Mirrors exactly what `SavingsGoals.tsx`'s `buildPayload` already sends to
 * `POST/PUT /savings-goals`. Amounts are major units (the page's form values), matching the
 * server's request body contract. */
export interface SavingsGoalPayload {
    name: string
    targetAmount: number
    currency: string
    targetDate: string | null
    accountId: string | null
    autoContribution: {
        enabled: boolean
        amount: number
        interval: AutoContributionInterval
        dayOfMonth?: number
    }
}

export interface UseSavingsGoalsDataResult {
    goals: SavingsGoal[] | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
    accounts: Account[] | null
    /** Real network status - callers should only act on this when `isLocalFirstEnabled()` is also
     * true, since the flag-off server branch never gated these actions on connectivity before. */
    online: boolean
    createGoal: (payload: SavingsGoalPayload) => Promise<void>
    updateGoal: (goal: SavingsGoal, payload: SavingsGoalPayload) => Promise<void>
    archiveGoal: (goal: SavingsGoal) => Promise<void>
    fetchContributionHistory: (goalId: string) => Promise<SavingsGoalContribution[]>
    /** The five actions below have server-computed side effects (contribution records, milestone
     * notifications, due-date math) genuinely out of scope to reimplement locally this sprint - they
     * stay plain REST calls even when `VITE_LOCAL_FIRST` is on, followed by a `syncNow()` + refetch
     * so the local mirror picks up the server-side change (see module doc on `online` above). */
    contribute: (goal: SavingsGoal, amount: number, note?: string) => Promise<void>
    processAutoContribution: (goal: SavingsGoal) => Promise<void>
    pause: (goal: SavingsGoal) => Promise<void>
    resume: (goal: SavingsGoal) => Promise<void>
    complete: (goal: SavingsGoal) => Promise<void>
}

const toGoalView = (
    goal: LocalSavingsGoalRecord & { progress: SavingsGoal['progress'] },
    timezone: string,
    now: Date
): SavingsGoal => ({
    _id: goal._id,
    userId: goal.userId,
    workspaceId: goal.workspaceId ?? null,
    name: goal.name,
    targetAmount: fromMinorUnits(goal.targetAmount),
    currentAmount: fromMinorUnits(goal.currentAmount),
    currency: goal.currency,
    targetDate: goal.targetDate,
    status: goal.status,
    accountId: goal.accountId ?? null,
    autoContribution: {
        enabled: goal.autoContribution.enabled,
        amount: fromMinorUnits(goal.autoContribution.amount),
        interval: goal.autoContribution.interval,
        dayOfMonth: goal.autoContribution.dayOfMonth,
        lastContributedAt: goal.autoContribution.lastContributedAt,
        isDue: isAutoContributionDuePure(
            {
                enabled: goal.autoContribution.enabled,
                amount: goal.autoContribution.amount,
                interval: goal.autoContribution.interval,
                dayOfMonth: goal.autoContribution.dayOfMonth,
                lastContributedAt: goal.autoContribution.lastContributedAt
                    ? new Date(goal.autoContribution.lastContributedAt)
                    : undefined,
            },
            timezone,
            now
        ),
    },
    progress: goal.progress,
    updatedAt: goal.updatedAt,
})

const toAccountView = (account: LocalAccount): Account => ({
    _id: account._id,
    userId: account.userId,
    workspaceId: account.workspaceId ?? null,
    name: account.name,
    type: account.type,
    currency: account.currency,
    openingBalance: account.openingBalance ?? account.currentBalance,
    currentBalance: account.currentBalance,
    isDefault: false,
    isArchived: account.isArchived,
    updatedAt: account.updatedAt,
})

const toContributionView = (contribution: LocalSavingsGoalContributionRecord): SavingsGoalContribution => ({
    _id: contribution._id,
    goalId: contribution.goalId,
    amount: fromMinorUnits(contribution.amount),
    type: contribution.type,
    note: contribution.note,
    contributedAt: contribution.contributedAt,
})

/**
 * Data layer for the Savings Goals dashboard page (Sprint 13.9). Branches on
 * `isLocalFirstEnabled()`: the server branch is the page's pre-existing `useAsyncData` + axios
 * code, relocated verbatim; the local branch reads/writes through the local SQLite store via
 * `Repository`/`useLocalQuery` for create/update/archive. `archiveGoal` writes `status: 'archived'`
 * via an update op (never `repo.remove()`) since `SavingsGoal` has no `deletedAt`, only a `status`
 * enum (mirrors `archiveSavingsGoal` in `backend/controllers/savingsGoalController.ts`).
 *
 * Note: the original page never scoped this fetch by workspace (no `useWorkspace()` import, no
 * `workspaceId` in `buildPayload`) - both branches here preserve that as-is rather than adding
 * workspace scoping that wasn't there before.
 */
export const useSavingsGoalsData = (view: GoalView): UseSavingsGoalsDataResult => {
    const { user } = useUser()
    const localFirst = isLocalFirstEnabled()
    const online = useOnlineStatus()

    const fetchGoals = useCallback(async (): Promise<SavingsGoal[]> => {
        try {
            const params: Record<string, string> = {}
            if (view === 'archived') {
                params.includeArchived = 'true'
                params.status = 'archived'
            } else if (view === 'completed') {
                params.status = 'completed'
            }
            const response = await axiosInstance.get<ApiResponse<SavingsGoal[]>>(
                API_PATHS.SAVINGS_GOALS.GET_ALL,
                { params }
            )
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load savings goals'))
        }
    }, [view])

    const serverQuery = useAsyncData(fetchGoals, [fetchGoals])

    const localFetcher = useCallback(async (db: LocalDb): Promise<SavingsGoal[]> => {
        const timezone = user?.timezone?.trim() || DEFAULT_TIMEZONE
        const now = new Date()
        const withProgress = await listLocalSavingsGoalsWithProgress(db, now)
        return (withProgress as Array<LocalSavingsGoalRecord & { progress: SavingsGoal['progress'] }>).map((goal) =>
            toGoalView(goal, timezone, now)
        )
    }, [user?.timezone])

    const localQuery = useLocalQuery<SavingsGoal[]>(
        ['savingsGoals', 'savingsGoalContributions', '_prefs'],
        localFetcher
    )

    const fetchAccounts = useCallback(async (): Promise<Account[]> => {
        const response = await axiosInstance.get<ApiResponse<Account[]>>(API_PATHS.ACCOUNTS.GET_ALL)
        return unwrapApiData(response).filter((account) => !account.isArchived)
    }, [])

    const serverAccountsQuery = useAsyncData(fetchAccounts, [fetchAccounts])

    const localAccountsFetcher = useCallback(async (db: LocalDb): Promise<Account[]> => {
        const rows = await accountsRepo.list(db)
        return rows.filter((account) => !account.isArchived).map(toAccountView)
    }, [])

    const localAccountsQuery = useLocalQuery<Account[]>('accounts', localAccountsFetcher)

    const afterServerMutation = async (): Promise<void> => {
        if (localFirst) {
            await syncNow()
            await localQuery.refetch()
        } else {
            await serverQuery.refetch()
        }
    }

    const guardOnline = (): void => {
        if (localFirst && !online) {
            throw new Error('This action requires an internet connection.')
        }
    }

    const shared: Pick<
        UseSavingsGoalsDataResult,
        'online' | 'fetchContributionHistory' | 'contribute' | 'processAutoContribution' | 'pause' | 'resume' | 'complete'
    > = {
        online,
        fetchContributionHistory: async (goalId) => {
            if (localFirst) {
                const db = await getLocalDb()
                const rows = await contributionsRepo.list(db)
                return rows
                    .filter((contribution) => contribution.goalId === goalId)
                    .map(toContributionView)
                    .sort((a, b) => new Date(b.contributedAt).getTime() - new Date(a.contributedAt).getTime())
            }
            const response = await axiosInstance.get<ApiResponse<SavingsGoalContribution[]>>(
                API_PATHS.SAVINGS_GOALS.CONTRIBUTIONS(goalId)
            )
            return unwrapApiData(response)
        },
        contribute: async (goal, amount, note) => {
            guardOnline()
            await axiosInstance.post(API_PATHS.SAVINGS_GOALS.CONTRIBUTE(goal._id), { amount, note })
            await afterServerMutation()
        },
        processAutoContribution: async (goal) => {
            guardOnline()
            await axiosInstance.post(API_PATHS.SAVINGS_GOALS.AUTO_CONTRIBUTE(goal._id))
            await afterServerMutation()
        },
        pause: async (goal) => {
            guardOnline()
            await axiosInstance.post(API_PATHS.SAVINGS_GOALS.PAUSE(goal._id))
            await afterServerMutation()
        },
        resume: async (goal) => {
            guardOnline()
            await axiosInstance.post(API_PATHS.SAVINGS_GOALS.RESUME(goal._id))
            await afterServerMutation()
        },
        complete: async (goal) => {
            guardOnline()
            await axiosInstance.post(API_PATHS.SAVINGS_GOALS.COMPLETE(goal._id))
            await afterServerMutation()
        },
    }

    if (!localFirst) {
        return {
            goals: serverQuery.data,
            loading: serverQuery.loading,
            error: serverQuery.error,
            refetch: serverQuery.refetch,
            accounts: serverAccountsQuery.data,
            createGoal: async (payload) => {
                await axiosInstance.post(API_PATHS.SAVINGS_GOALS.CREATE, payload)
                await serverQuery.refetch()
            },
            updateGoal: async (goal, payload) => {
                await axiosInstance.put(API_PATHS.SAVINGS_GOALS.UPDATE(goal._id), payload)
                await serverQuery.refetch()
            },
            archiveGoal: async (goal) => {
                await axiosInstance.delete(API_PATHS.SAVINGS_GOALS.DELETE(goal._id))
                await serverQuery.refetch()
            },
            ...shared,
        }
    }

    return {
        goals: localQuery.data,
        loading: localQuery.loading,
        error: localQuery.error,
        refetch: localQuery.refetch,
        accounts: localAccountsQuery.data,
        createGoal: async (payload) => {
            if (!user) throw new Error('Not authenticated')
            const db = await getLocalDb()
            const doc: LocalSavingsGoalRecord = {
                _id: generateLocalObjectId(),
                updatedAt: new Date().toISOString(),
                userId: user._id,
                workspaceId: null,
                name: payload.name,
                targetAmount: toMinorUnits(payload.targetAmount),
                currentAmount: 0,
                currency: payload.currency,
                targetDate: payload.targetDate,
                status: 'active',
                accountId: payload.accountId,
                autoContribution: {
                    enabled: payload.autoContribution.enabled,
                    amount: toMinorUnits(payload.autoContribution.amount),
                    interval: payload.autoContribution.interval,
                    dayOfMonth: payload.autoContribution.dayOfMonth,
                },
            }
            await db.transaction(async (tx) => {
                await goalsRepo.create(tx, doc)
            })
            tableInvalidationBus.publish('savingsGoals')
        },
        updateGoal: async (goal, payload) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await goalsRepo.findById(tx, goal._id)
                if (!existing) throw new Error('Savings goal not found')
                const updated: LocalSavingsGoalRecord = {
                    ...existing,
                    name: payload.name,
                    targetAmount: toMinorUnits(payload.targetAmount),
                    currency: payload.currency,
                    targetDate: payload.targetDate,
                    accountId: payload.accountId,
                    autoContribution: {
                        ...existing.autoContribution,
                        enabled: payload.autoContribution.enabled,
                        amount: toMinorUnits(payload.autoContribution.amount),
                        interval: payload.autoContribution.interval,
                        dayOfMonth: payload.autoContribution.dayOfMonth,
                    },
                }
                await goalsRepo.update(tx, updated, existing.updatedAt)
            })
            tableInvalidationBus.publish('savingsGoals')
        },
        archiveGoal: async (goal) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await goalsRepo.findById(tx, goal._id)
                if (!existing) throw new Error('Savings goal not found')
                await goalsRepo.update(tx, { ...existing, status: 'archived' }, existing.updatedAt)
            })
            tableInvalidationBus.publish('savingsGoals')
        },
        ...shared,
    }
}
