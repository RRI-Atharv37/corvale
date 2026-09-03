import { useCallback, useEffect } from 'react'
import { roundMoney } from '@shared/money'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { useAsyncData } from '@/app/hooks/useAsyncData'
import { useLocalQuery } from '@platform/db/useLocalQuery'
import { getLocalDb } from '@platform/db/localDbInstance'
import { tableInvalidationBus } from '@lib/tableInvalidationBus'
import { Repository } from '@platform/db/repositories/Repository'
import { generateLocalObjectId } from '@platform/db/generateLocalId'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import { getLocalUserPrefs } from '@platform/db/localUserPrefs'
import { convertAmountWithRates } from '@domain/currency'
import { recomputeLocalAccountBalance } from '@domain/accountBalances'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'
import { buildWorkspaceBodyFields, buildWorkspaceQueryParams } from '@lib/workspaceScope'
import { DEFAULT_CURRENCY } from '@lib/currencies'
import { useUser } from '@/app/providers/useUser'
import { useWorkspace } from '@/app/providers/useWorkspace'
import type { Account, AccountType, ApiResponse } from '@lib/types/api'
import type { LocalAccount } from '@domain/types'
import type { LocalDb } from '@platform/db/LocalDb'

/** `LocalAccount` (domain/types.ts) has no `isDefault`/`interestRate`/`minimumPayment` fields yet -
 * they round-trip fine through the JSON `data` blob (Repository stores the full doc), this just
 * widens the local type so this hook can read/write them without touching shared infra. */
interface LocalAccountRecord extends LocalAccount {
    isDefault: boolean
    interestRate?: number
    minimumPayment?: number
}

const accountsRepo = new Repository<LocalAccountRecord>('accounts')

export interface CreateAccountInput {
    name: string
    type: AccountType
    currency: string
    openingBalance: number
    /** ISO date (YYYY-MM-DD or full ISO). Balance is stated "as of" this date. */
    openingBalanceDate?: string
    interestRate?: number
    minimumPayment?: number
}

export interface UpdateAccountInput {
    name: string
    type: AccountType
    /** Editable post-creation; a change forces a server-side balance recompute. */
    openingBalance?: number
    openingBalanceDate?: string | null
    interestRate?: number
    minimumPayment?: number
}

export interface UseAccountsDataResult {
    accounts: Account[] | null
    loading: boolean
    error: string | null
    refetch: () => Promise<void>
    createAccount: (input: CreateAccountInput) => Promise<void>
    updateAccount: (account: Account, input: UpdateAccountInput) => Promise<void>
    archiveAccount: (account: Account) => Promise<void>
    setDefaultAccount: (account: Account) => Promise<void>
}

const toAccountView = (
    account: LocalAccountRecord,
    preferredCurrency: string,
    exchangeRates: Record<string, number>
): Account => {
    const { convertedAmount, rateApplied, rateConfigured } = convertAmountWithRates(
        account.currentBalance,
        account.currency,
        preferredCurrency,
        exchangeRates
    )
    return {
        _id: account._id,
        userId: account.userId,
        workspaceId: account.workspaceId ?? null,
        name: account.name,
        type: account.type,
        currency: account.currency,
        openingBalance: account.openingBalance ?? account.currentBalance,
        openingBalanceDate: account.openingBalanceDate ?? null,
        currentBalance: account.currentBalance,
        isDefault: account.isDefault ?? false,
        isArchived: account.isArchived,
        interestRate: account.interestRate,
        minimumPayment: account.minimumPayment,
        convertedBalance: roundMoney(convertedAmount),
        exchangeRateApplied: rateApplied,
        hasExchangeRate: rateConfigured,
    }
}

/** Mirrors `unsetPreviousDefault` in `backend/controllers/accountController.ts` - only one
 * personal (non-workspace) account can be default at a time. */
const findCurrentDefault = (accounts: LocalAccountRecord[], excludeId?: string): LocalAccountRecord | undefined =>
    accounts.find(
        (account) => account.isDefault && !account.isArchived && !account.workspaceId && account._id !== excludeId
    )

/**
 * Data layer for the Accounts dashboard page (Sprint 13.9). Branches on `isLocalFirstEnabled()`:
 * the server branch is the page's pre-existing `useAsyncData` + axios code, relocated verbatim;
 * the local branch reads/writes through the local SQLite store via `Repository`/`useLocalQuery`.
 */
export const useAccountsData = (): UseAccountsDataResult => {
    const { user } = useUser()
    const { activeWorkspaceId } = useWorkspace()
    const localFirst = isLocalFirstEnabled()

    const fetchAccounts = useCallback(async (): Promise<Account[]> => {
        // Both branches' hooks are always called (rules of hooks), but when local-first is on the
        // server branch's result is never read - skip the network round-trip rather than firing it
        // uselessly on every mount.
        if (localFirst) return []
        try {
            const response = await axiosInstance.get<ApiResponse<Account[]>>(API_PATHS.ACCOUNTS.GET_ALL, {
                params: buildWorkspaceQueryParams(activeWorkspaceId),
            })
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load accounts'))
        }
    }, [activeWorkspaceId, localFirst])

    const serverQuery = useAsyncData(fetchAccounts, [fetchAccounts])

    const localFetcher = useCallback(
        async (db: LocalDb): Promise<Account[]> => {
            const [rows, prefs] = await Promise.all([accountsRepo.list(db), getLocalUserPrefs(db)])
            const preferredCurrency = prefs?.preferredCurrency ?? DEFAULT_CURRENCY
            const exchangeRates = prefs?.exchangeRates ?? {}
            return rows
                .filter((account) => !account.isArchived)
                .filter((account) => (activeWorkspaceId ? account.workspaceId === activeWorkspaceId : !account.workspaceId))
                .map((account) => toAccountView(account, preferredCurrency, exchangeRates))
                .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
        },
        [activeWorkspaceId]
    )

    const localQuery = useLocalQuery<Account[]>(['accounts', '_prefs'], localFetcher)

    // `useLocalQuery` only refetches on table invalidation or mount - it has no dependency on
    // `activeWorkspaceId`, so switching workspaces needs an explicit refetch to re-run the filter.
    useEffect(() => {
        if (localFirst) {
            void localQuery.refetch()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeWorkspaceId, localFirst])

    if (!localFirst) {
        return {
            accounts: serverQuery.data,
            loading: serverQuery.loading,
            error: serverQuery.error,
            refetch: serverQuery.refetch,
            createAccount: async (input) => {
                await axiosInstance.post(API_PATHS.ACCOUNTS.CREATE, {
                    name: input.name,
                    type: input.type,
                    currency: input.currency,
                    openingBalance: input.openingBalance,
                    openingBalanceDate: input.openingBalanceDate,
                    interestRate: input.interestRate,
                    minimumPayment: input.minimumPayment,
                    ...buildWorkspaceBodyFields(activeWorkspaceId),
                })
                await serverQuery.refetch()
            },
            updateAccount: async (account, input) => {
                await axiosInstance.put(API_PATHS.ACCOUNTS.UPDATE(account._id), {
                    name: input.name,
                    type: input.type,
                    ...(input.openingBalance !== undefined && { openingBalance: input.openingBalance }),
                    ...(input.openingBalanceDate !== undefined && {
                        openingBalanceDate: input.openingBalanceDate,
                    }),
                    interestRate: input.interestRate,
                    minimumPayment: input.minimumPayment,
                })
                await serverQuery.refetch()
            },
            archiveAccount: async (account) => {
                await axiosInstance.delete(API_PATHS.ACCOUNTS.DELETE(account._id))
                await serverQuery.refetch()
            },
            setDefaultAccount: async (account) => {
                if (account.isDefault) return
                await axiosInstance.put(API_PATHS.ACCOUNTS.UPDATE(account._id), { isDefault: true })
                await serverQuery.refetch()
            },
        }
    }

    return {
        accounts: localQuery.data,
        loading: localQuery.loading,
        error: localQuery.error,
        refetch: localQuery.refetch,
        createAccount: async (input) => {
            if (!user) throw new Error('Not authenticated')
            const db = await getLocalDb()
            const nowIso = new Date().toISOString()
            const _id = generateLocalObjectId()
            await db.transaction(async (tx) => {
                const existing = await accountsRepo.list(tx)
                const activePersonalCount = existing.filter((a) => !a.workspaceId && !a.isArchived).length
                const shouldBeDefault = !activeWorkspaceId && activePersonalCount === 0

                if (shouldBeDefault) {
                    const currentDefault = findCurrentDefault(existing)
                    if (currentDefault) {
                        await accountsRepo.update(
                            tx,
                            { ...currentDefault, isDefault: false },
                            currentDefault.updatedAt
                        )
                    }
                }

                const doc: LocalAccountRecord = {
                    _id,
                    updatedAt: nowIso,
                    userId: user._id,
                    workspaceId: activeWorkspaceId ?? null,
                    name: input.name,
                    type: input.type,
                    currency: input.currency,
                    // Mirrors the server: `currentBalance` is server-derived, never client-set -
                    // it is simply initialized to `openingBalance` on create either way.
                    currentBalance: input.openingBalance,
                    openingBalance: input.openingBalance,
                    openingBalanceDate: input.openingBalanceDate ?? null,
                    isDefault: shouldBeDefault,
                    isArchived: false,
                    interestRate: input.interestRate,
                    minimumPayment: input.minimumPayment,
                }
                await accountsRepo.create(tx, doc)
            })
            tableInvalidationBus.publish('accounts')
        },
        updateAccount: async (account, input) => {
            const db = await getLocalDb()
            const opensChanged =
                input.openingBalance !== undefined || input.openingBalanceDate !== undefined
            await db.transaction(async (tx) => {
                const existing = await accountsRepo.findById(tx, account._id)
                if (!existing) throw new Error('Account not found')
                await accountsRepo.update(
                    tx,
                    {
                        ...existing,
                        name: input.name,
                        type: input.type,
                        ...(input.openingBalance !== undefined && {
                            openingBalance: input.openingBalance,
                        }),
                        ...(input.openingBalanceDate !== undefined && {
                            openingBalanceDate: input.openingBalanceDate,
                        }),
                        interestRate: input.interestRate,
                        minimumPayment: input.minimumPayment,
                    },
                    existing.updatedAt
                )
            })
            // Opening balance / date drive the from-scratch balance, so a change
            // forces a recompute (mirrors the server's updateAccount).
            if (opensChanged) {
                const recomputed = await recomputeLocalAccountBalance(db, account._id)
                await db.transaction(async (tx) => {
                    const current = await accountsRepo.findById(tx, account._id)
                    if (!current) return
                    await accountsRepo.update(
                        tx,
                        { ...current, currentBalance: recomputed },
                        current.updatedAt
                    )
                })
            }
            tableInvalidationBus.publish('accounts')
        },
        archiveAccount: async (account) => {
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await accountsRepo.findById(tx, account._id)
                if (!existing) throw new Error('Account not found')
                await accountsRepo.update(tx, { ...existing, isArchived: true, isDefault: false }, existing.updatedAt)
            })
            tableInvalidationBus.publish('accounts')
        },
        setDefaultAccount: async (account) => {
            if (account.isDefault) return
            const db = await getLocalDb()
            await db.transaction(async (tx) => {
                const existing = await accountsRepo.list(tx)
                const currentDefault = findCurrentDefault(existing, account._id)
                if (currentDefault) {
                    await accountsRepo.update(tx, { ...currentDefault, isDefault: false }, currentDefault.updatedAt)
                }
                const target = await accountsRepo.findById(tx, account._id)
                if (!target) throw new Error('Account not found')
                await accountsRepo.update(tx, { ...target, isDefault: true }, target.updatedAt)
            })
            tableInvalidationBus.publish('accounts')
        },
    }
}
