import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'
import { buildWorkspaceQueryParams } from '@lib/workspaceScope'
import { getBalanceDeltaMajor, roundMoney, toMinorUnits } from '@shared/money'
import type { PaginationMeta } from '@lib/types/api'
import type { Account, AccountType } from '@features/accounts/types'
import type { Transaction, TransactionType } from '@features/transactions/types'

const PAGE_SIZE = 200

export const effectiveBalanceType = (transaction: Transaction): TransactionType =>
    transaction.type === 'transfer' && transaction.transferDirection === 'in' ? 'income' : transaction.type

/** Net effect of the cleared rows on the account's balance, signed like the server's reconciliation session. */
export const computeClearedDelta = (transactions: Transaction[], accountType: AccountType): number =>
    roundMoney(
        transactions
            .filter((transaction) => transaction.clearedStatus === 'cleared')
            .reduce(
                (sum, transaction) =>
                    sum + getBalanceDeltaMajor(effectiveBalanceType(transaction), toMinorUnits(transaction.amount), accountType),
                0
            )
    )

/** Every posted, pending or cleared row on the account, oldest first, across all pages. */
export const fetchUnreconciledTransactions = async (
    account: Pick<Account, '_id' | 'workspaceId'>
): Promise<Transaction[]> => {
    const rows: Transaction[] = []
    let page = 1
    let totalPages = 1

    try {
        while (page <= totalPages) {
            const response = await axiosInstance.get(API_PATHS.TRANSACTIONS.GET_ALL, {
                params: {
                    accountId: account._id,
                    clearedStatus: 'pending,cleared',
                    status: 'posted',
                    sortBy: 'date',
                    sortOrder: 'asc',
                    limit: PAGE_SIZE,
                    page,
                    ...buildWorkspaceQueryParams(account.workspaceId),
                },
            })
            const body = unwrapApiData(response) as { data: Transaction[]; meta: PaginationMeta }
            rows.push(...body.data)
            totalPages = body.meta.totalPages
            page += 1
        }
    } catch (error) {
        throw new Error(getApiErrorMessage(error, 'Failed to load transactions'))
    }

    return rows
}
