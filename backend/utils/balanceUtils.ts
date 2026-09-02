import Saver from '../models/Saver'
import Account, { IAccount } from '../models/Account'
import Transaction from '../models/Transaction'
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
import { fromMinorUnits, roundMoney } from '@shared/money'
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
        // (see shared/src/balances.ts) — an account migrated to minor-unit
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
 * `Transaction` collection (BUG-01) — mirrors the exclusions
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
 * Recomputes one account's balance from scratch — its opening balance and
 * opening-balance date plus every posted, non-split transaction on it — and
 * returns the result in **major units** (the caller stores it in the account's
 * own `balanceUnit`). Transfer legs are resolved to in/out by creation order
 * relative to their pair, the same technique `deleteTransactionForUser` uses,
 * since both legs persist as `type: 'transfer'`.
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
    }).select('type amount status splitTransactionId transferPairId createdAt date')

    const pairIds = transactions
        .filter((transaction) => transaction.type === 'transfer' && transaction.transferPairId)
        .map((transaction) => transaction.transferPairId!)

    const pairs = pairIds.length
        ? await Transaction.find({ ...scope, _id: { $in: pairIds } }).select('createdAt')
        : []
    const pairCreatedAtById = new Map(pairs.map((pair) => [pair._id.toString(), pair.createdAt]))

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
                const pairCreatedAt = pairCreatedAtById.get(transaction.transferPairId.toString())
                const isInbound = pairCreatedAt !== undefined && transaction.createdAt > pairCreatedAt
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
