import { useCallback } from 'react'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { useAsyncData } from '@/app/hooks/useAsyncData'
import { useLocalQuery } from '@platform/db/useLocalQuery'
import { getLocalDb } from '@platform/db/localDbInstance'
import { Repository } from '@platform/db/repositories/Repository'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import { computeLocalDebtPayoffPlan } from '@domain/debtPayoff'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'
import { buildWorkspaceBodyFields, buildWorkspaceQueryParams } from '@lib/workspaceScope'
import { useWorkspace } from '@/app/providers/useWorkspace'
import type { ApiResponse } from '@lib/types/api'
import type { Account } from '@features/accounts/types'
import type { DebtPayoffPlan, DebtPayoffStrategy } from '@features/debts/types'
import type { LocalAccount } from '@domain/types'
import type { LocalDb } from '@platform/db/LocalDb'

/** `LocalAccount` (domain/types.ts) has no `interestRate`/`minimumPayment` fields yet - they
 * round-trip fine through the JSON `data` blob (Repository stores the full doc), this just widens
 * the local type so this hook can surface them, mirroring `useAccountsData.ts`. */
interface LocalAccountRecord extends LocalAccount {
    interestRate?: number
    minimumPayment?: number
}

const accountsRepo = new Repository<LocalAccountRecord>('accounts')

const toAccountView = (account: LocalAccountRecord): Account => ({
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
    interestRate: account.interestRate,
    minimumPayment: account.minimumPayment,
    updatedAt: account.updatedAt,
})

export interface UseDebtPayoffDataResult {
    accounts: Account[] | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
    generatePlan: (strategy: DebtPayoffStrategy, extraPayment: number, accountIds: string[]) => Promise<DebtPayoffPlan>
}

/**
 * Data layer for the Debt Payoff dashboard page (Sprint 13.10). Branches on
 * `isLocalFirstEnabled()`: the server branch is the page's pre-existing `useAsyncData` + axios
 * code, relocated verbatim; the local branch reads accounts from the local SQLite store and
 * computes the payoff schedule via `domain/debtPayoff.ts`'s `computeLocalDebtPayoffPlan` -
 * a read-only calculation with no persisted resource on either branch, so `generatePlan` is a
 * plain async function rather than a table-backed mutation. `computeLocalDebtPayoffPlan` throws a
 * plain `Error` for an unpayable schedule; `DebtPayoff.tsx`'s existing `getApiErrorMessage(err, ...)`
 * catch already treats a thrown `Error`'s `.message` the same as a server 400, so no page-level
 * error-handling change is needed.
 */
export const useDebtPayoffData = (): UseDebtPayoffDataResult => {
    const { activeWorkspaceId } = useWorkspace()
    const localFirst = isLocalFirstEnabled()

    const fetchAccounts = useCallback(async (): Promise<Account[]> => {
        if (localFirst) return []
        const response = await axiosInstance.get<ApiResponse<Account[]>>(API_PATHS.ACCOUNTS.GET_ALL, {
            params: buildWorkspaceQueryParams(activeWorkspaceId),
        })
        return unwrapApiData(response).filter((account) => !account.isArchived)
    }, [activeWorkspaceId, localFirst])

    const serverQuery = useAsyncData(fetchAccounts, [fetchAccounts])

    const localFetcher = useCallback(
        async (db: LocalDb): Promise<Account[]> => {
            const rows = await accountsRepo.list(db)
            return rows
                .filter((account) => !account.isArchived)
                .filter((account) => (activeWorkspaceId ? account.workspaceId === activeWorkspaceId : !account.workspaceId))
                .map(toAccountView)
        },
        [activeWorkspaceId]
    )

    const localQuery = useLocalQuery<Account[]>('accounts', localFetcher)

    const generatePlan = useCallback(
        async (strategy: DebtPayoffStrategy, extraPayment: number, accountIds: string[]): Promise<DebtPayoffPlan> => {
            if (!localFirst) {
                try {
                    const response = await axiosInstance.post<ApiResponse<DebtPayoffPlan>>(API_PATHS.DEBTS.PLAN, {
                        strategy,
                        extraPayment,
                        ...(accountIds.length > 0 ? { accountIds } : {}),
                        ...buildWorkspaceBodyFields(activeWorkspaceId),
                    })
                    return unwrapApiData(response)
                } catch (error) {
                    throw new Error(getApiErrorMessage(error, 'Failed to generate payoff plan'))
                }
            }

            const db = await getLocalDb()
            return computeLocalDebtPayoffPlan(db, {
                strategy,
                extraPayment,
                accountIds: accountIds.length > 0 ? accountIds : undefined,
                workspaceId: activeWorkspaceId ?? null,
            })
        },
        [localFirst, activeWorkspaceId]
    )

    if (!localFirst) {
        return {
            accounts: serverQuery.data,
            loading: serverQuery.loading,
            error: serverQuery.error,
            refetch: serverQuery.refetch,
            generatePlan,
        }
    }

    return {
        accounts: localQuery.data,
        loading: localQuery.loading,
        error: localQuery.error,
        refetch: localQuery.refetch,
        generatePlan,
    }
}
