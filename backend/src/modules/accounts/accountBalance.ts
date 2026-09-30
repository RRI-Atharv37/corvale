import { AsyncLocalStorage } from 'node:async_hooks'
import { Types } from 'mongoose'

import { Saver } from '@modules/savers'
import Account, { IAccount } from './account.model'
import { Transaction } from '@modules/transactions'
import { buildScopedListFilter } from '@core/access/workspace'
import {
    AccountLike,
    AccountTotals,
    computeAccountTotalsPure,
    computeUserBalancesPure,
    CurrencyConversionOptions,
    recomputeAccountBalance,
    UserBalanceSummary,
} from '@shared/balances'
import { fromMinorUnits, roundMoney, toMinorUnits } from '@shared/money'
import { isInboundTransferLeg } from '@shared/transferDirection'
import { toObjectId } from '@core/db/objectId'

export { roundMoney }
export type { AccountTotals, UserBalanceSummary, CurrencyConversionOptions }

const toAccountsLike = (
    accounts: Array<{
        type: AccountLike['type']
        currentBalance: number
        currency: string
        isArchived: boolean
        balanceUnit?: 'major' | 'minor'
    }>
): AccountLike[] =>
    accounts.map((account) => ({
        type: account.type,
        // AccountLike/computeAccountTotalsPure operate in major units throughout
        // (see shared/src/balances.ts) - an account migrated to minor-unit
        // storage (Sprint C5) is converted back to major here, at the boundary,
        // so that shared function never needs to know about the flag.
        currentBalance: account.balanceUnit === 'minor' ? fromMinorUnits(account.currentBalance) : account.currentBalance,
        currency: account.currency,
        isArchived: account.isArchived,
    }))

const POSTED_LEDGER_FILTER = {
    status: 'posted' as const,
    splitTransactionId: null,
}

/**
 * Lifetime posted income/expense totals sourced from the unified
 * `Transaction` collection (BUG-01) - mirrors the exclusions
 * `sumPostedTransactionsByType` (dashboardUtils.ts) applies for the
 * period-scoped dashboard summary (posted only, split children excluded,
 * transfers excluded via the `type` match), just without a date bound.
 */
const sumLifetimePostedTransactionsByType = async (
    userId: string,
    type: 'income' | 'expense'
): Promise<number> => {
    const result = await Transaction.aggregate([
        {
            $match: {
                ...buildScopedListFilter(userId, null),
                type,
                ...POSTED_LEDGER_FILTER,
            },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
    ])

    return fromMinorUnits(result[0]?.total ?? 0)
}

/**
 * Pre-Phase-1c bridge: when active accounts exist, net worth and spendable
 * derive from account balances. Income/expense totals remain activity metrics only.
 * Full transaction-driven account updates arrive in Phase 1c.
 */
export const computeAccountTotals = async (
    userId: string,
    workspaceId?: string | null,
    conversion?: CurrencyConversionOptions
): Promise<AccountTotals> => {
    const accounts = await Account.find({
        ...buildScopedListFilter(userId, workspaceId ?? null),
        isArchived: false,
    })

    return computeAccountTotalsPure(toAccountsLike(accounts), conversion)
}

export const computeUserBalances = async (
    userId: string,
    workspaceId?: string | null,
    conversion?: CurrencyConversionOptions
): Promise<UserBalanceSummary> => {
    const accounts = await Account.find({
        ...buildScopedListFilter(userId, workspaceId ?? null),
        isArchived: false,
    })
    const accountsLike = toAccountsLike(accounts)

    if (workspaceId) {
        return computeUserBalancesPure({
            accounts: accountsLike,
            totalIncomeMajor: 0,
            totalExpensesMajor: 0,
            saverBalanceMajor: 0,
            workspaceId,
            conversion,
        })
    }

    const [totalIncomeMajor, totalExpensesMajor, saver] = await Promise.all([
        sumLifetimePostedTransactionsByType(userId, 'income'),
        sumLifetimePostedTransactionsByType(userId, 'expense'),
        Saver.findOne({ userId: toObjectId(userId) }),
    ])

    return computeUserBalancesPure({
        accounts: accountsLike,
        totalIncomeMajor,
        totalExpensesMajor,
        saverBalanceMajor: saver?.saverAmount ?? 0,
        workspaceId: null,
        conversion,
    })
}

/**
 * Recomputes one account's balance from scratch - its opening balance and
 * opening-balance date plus every posted, non-split transaction on it - and
 * returns the result in **major units** (the caller stores it in the account's
 * own `balanceUnit`). Transfer legs are resolved to in/out by their stored
 * `transferRole`, or by creation order relative to their pair for a leg not yet
 * backfilled, since both legs persist as `type: 'transfer'`.
 *
 * Shared by the REST recompute endpoint, `updateAccount` (opening-balance edits
 * trigger a recompute) and the sync push path, so the three stay identical.
 */
export const recomputeAccountBalanceMajor = async (
    account: Pick<
        IAccount,
        '_id' | 'type' | 'openingBalance' | 'openingBalanceDate' | 'balanceUnit' | 'workspaceId'
    >,
    userId: string
): Promise<number> => {
    const scope = buildScopedListFilter(userId, account.workspaceId?.toString() ?? null)

    const transactions = await Transaction.find({
        ...scope,
        accountId: account._id,
    })
        .select('type amount status splitTransactionId transferPairId transferRole createdAt date')
        .lean()

    const pairIds = transactions
        .filter(
            (transaction) =>
                transaction.type === 'transfer' &&
                transaction.transferPairId &&
                !transaction.transferRole
        )
        .map((transaction) => transaction.transferPairId!)

    const pairs = pairIds.length
        ? await Transaction.find({ ...scope, _id: { $in: pairIds } })
              .select('createdAt transferRole')
              .lean()
        : []
    const pairStampById = new Map(pairs.map((pair) => [pair._id.toString(), pair]))

    const isMinor = account.balanceUnit === 'minor'
    const openingBalanceMajor = isMinor
        ? fromMinorUnits(account.openingBalance)
        : account.openingBalance

    return recomputeAccountBalance(
        {
            openingBalance: openingBalanceMajor,
            type: account.type,
            openingBalanceDate: account.openingBalanceDate ?? null,
        },
        transactions.map((transaction) => {
            let effectiveType = transaction.type

            if (transaction.type === 'transfer' && transaction.transferPairId) {
                const pair = pairStampById.get(transaction.transferPairId.toString())
                const isInbound =
                    transaction.transferRole != null || pair !== undefined
                        ? isInboundTransferLeg(
                              {
                                  id: transaction._id.toString(),
                                  createdAt: transaction.createdAt,
                                  transferRole: transaction.transferRole,
                              },
                              {
                                  id: transaction.transferPairId.toString(),
                                  createdAt: pair?.createdAt ?? transaction.createdAt,
                                  transferRole: pair?.transferRole,
                              }
                          )
                        : false
                effectiveType = isInbound ? 'income' : 'transfer'
            }

            return {
                type: effectiveType,
                amount: transaction.amount,
                status: transaction.status,
                splitTransactionId: transaction.splitTransactionId?.toString() ?? null,
                date: transaction.date,
            }
        })
    )
}

const MAX_REFRESH_ATTEMPTS = 5

const refreshAccountBalance = async (accountId: string): Promise<void> => {
    for (let attempt = 1; attempt <= MAX_REFRESH_ATTEMPTS; attempt += 1) {
        const account = await Account.findById(accountId)
        if (!account) {
            return
        }

        const recomputedMajor = await recomputeAccountBalanceMajor(account, account.userId.toString())
        const next = account.balanceUnit === 'minor' ? toMinorUnits(recomputedMajor) : recomputedMajor
        if (next === account.currentBalance) {
            return
        }

        const scoped = {
            _id: account._id,
            ...buildScopedListFilter(account.userId.toString(), account.workspaceId?.toString() ?? null),
        }
        const filter =
            attempt === MAX_REFRESH_ATTEMPTS
                ? scoped
                : {
                      ...scoped,
                      currentBalance: account.currentBalance,
                      ...(account.updatedAt ? { updatedAt: account.updatedAt } : {}),
                  }
        const result = await Account.updateOne(filter, { $set: { currentBalance: next } })
        if (result.matchedCount === 1) {
            return
        }
    }
}

const deferredRefreshes = new AsyncLocalStorage<Set<string>>()

/**
 * Brings the stored `currentBalance` of each account back in line with its ledger (opening balance
 * plus every posted, non-split transaction on or after the balance-as-of date). Every transaction
 * write ends here instead of adding a delta, so drafts, status flips, out-of-order sync replays and
 * concurrent writers all converge on the same figure. The write is a compare-and-set on the value
 * the recompute started from; a writer that loses the race recomputes again.
 *
 * Inside `withDeferredBalanceRefresh` the ids are only collected and each account is recomputed
 * once when the outermost scope ends.
 */
export const refreshAccountBalances = async (
    accountIds: ReadonlyArray<Types.ObjectId | string | null | undefined>
): Promise<void> => {
    const unique = new Set<string>()
    for (const accountId of accountIds) {
        if (accountId) {
            unique.add(accountId.toString())
        }
    }

    const deferred = deferredRefreshes.getStore()
    if (deferred) {
        unique.forEach((accountId) => deferred.add(accountId))
        return
    }

    for (const accountId of unique) {
        await refreshAccountBalance(accountId)
    }
}

export const withDeferredBalanceRefresh = async <T>(work: () => Promise<T>): Promise<T> => {
    if (deferredRefreshes.getStore()) {
        return work()
    }

    const pending = new Set<string>()
    let result: T
    try {
        result = await deferredRefreshes.run(pending, work)
    } catch (error) {
        try {
            await refreshAccountBalances([...pending])
        } catch {
            // the original failure is the one worth reporting
        }
        throw error
    }

    await refreshAccountBalances([...pending])
    return result
}
