import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { buildScopedListFilter } from '@core/access/workspace'
import { CLEARED_STATUSES, ClearedStatus, Transaction } from '@modules/transactions'
import { Account } from '@modules/accounts'
import { resolveBalanceTypes } from '@modules/accounts/accountBalance'
import { assertWorkspaceMembership, validateResourceAccess } from '@modules/workspaces/access'
import { fromMinorUnits, getBalanceDeltaMajor, roundMoney } from '@shared/money'
import ReconciliationSession from './reconciliationSession.model'

export const isClearedStatus = (value: unknown): value is ClearedStatus =>
    typeof value === 'string' && CLEARED_STATUSES.includes(value as ClearedStatus)

export const setClearedStatus = async (input: {
    userId: string
    transactionId: string
    clearedStatus: ClearedStatus
    reconciledAt: Date | null
}) => {
    const { userId, transactionId, clearedStatus, reconciledAt } = input

    const transaction = await Transaction.findById(transactionId)
    if (!transaction) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND, 404)
    }

    if (transaction.workspaceId) {
        await assertWorkspaceMembership(transaction.workspaceId.toString(), userId, 'editor')
    } else if (transaction.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    transaction.clearedStatus = clearedStatus
    if (reconciledAt) {
        transaction.reconciledAt = reconciledAt
    } else if (clearedStatus !== 'reconciled') {
        transaction.reconciledAt = null
    }

    await transaction.save()
    return transaction
}

/**
 * Cleared and pending balances for one account as of the statement date. Counts what the account
 * balance counts: posted, non-split-line rows, with transfer legs signed by their resolved direction.
 * When the account carries an openingBalanceDate, activity before it is already folded into
 * openingBalance (see shared/src/balances.ts) and is excluded with a lower date bound.
 */
export const createSession = async (input: {
    userId: string
    accountId: string
    statementEndDate: Date
    statementBalance: number
}) => {
    const { userId, accountId, statementEndDate, statementBalance } = input

    const account = await validateResourceAccess(
        Account,
        accountId,
        userId,
        ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
        'editor'
    )

    const workspaceId = account.workspaceId ? account.workspaceId.toString() : null
    const scope = buildScopedListFilter(userId, workspaceId)

    const dateFilter: Record<string, Date> = { $lte: statementEndDate }
    if (account.openingBalanceDate) {
        dateFilter.$gte = new Date(account.openingBalanceDate)
    }

    const transactions = await Transaction.find({
        ...scope,
        accountId,
        splitTransactionId: null,
        status: { $ne: 'draft' },
        date: dateFilter,
    })
        .select('type amount clearedStatus transferPairId transferRole createdAt')
        .lean()

    const effectiveTypes = await resolveBalanceTypes(transactions, scope)
    const entries = transactions.map((transaction, index) => ({
        clearedStatus: transaction.clearedStatus,
        delta: getBalanceDeltaMajor(effectiveTypes[index], transaction.amount, account.type),
    }))

    const sumDeltas = (include: (status: ClearedStatus) => boolean): number =>
        roundMoney(
            entries
                .filter((entry) => include(entry.clearedStatus))
                .reduce((sum, entry) => sum + entry.delta, 0)
        )

    // 'reconciled' transactions were cleared in a prior session and still count as settled.
    const openingBalanceMajor =
        account.balanceUnit === 'minor' ? fromMinorUnits(account.openingBalance) : account.openingBalance
    const clearedBalance = roundMoney(
        openingBalanceMajor + sumDeltas((status) => status === 'cleared' || status === 'reconciled')
    )
    const pendingBalance = sumDeltas((status) => status === 'pending')
    const balanceDifferential = roundMoney(Math.abs(statementBalance - clearedBalance))

    return ReconciliationSession.create({
        userId,
        workspaceId,
        accountId,
        statementEndDate,
        statementBalance,
        clearedBalance,
        pendingBalance,
        balanceDifferential,
    })
}

export const listSessions = async (userId: string, accountId: string) => {
    const account = await validateResourceAccess(
        Account,
        accountId,
        userId,
        ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
        'viewer'
    )

    const workspaceId = account.workspaceId ? account.workspaceId.toString() : null

    return ReconciliationSession.find({
        ...buildScopedListFilter(userId, workspaceId),
        accountId,
    }).sort({ statementEndDate: -1 })
}
