import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import Transaction, { CLEARED_STATUSES } from '../models/Transaction'
import ReconciliationSession from '../models/ReconciliationSession'
import Account from '../models/Account'
import { roundMoney } from '../utils/balanceUtils'
import { getBalanceDeltaMajor } from '../utils/transactionUtils'
import { fromMinorUnits } from '../../shared/src/money'
import {
    getUserId,
    validateRequiredFields,
} from '../utils/sharedUtils'
import {
    assertWorkspaceMembership,
    buildScopedListFilter,
    validateResourceAccess,
} from '../utils/workspaceUtils'

export const updateClearedStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { transactionId } = req.params
    const { clearedStatus, reconciledAt } = req.body

    validateRequiredFields(req.body, ['clearedStatus'])

    if (!CLEARED_STATUSES.includes(clearedStatus)) {
        throw new CustomError(
            `${ERROR_MESSAGES.RECONCILIATION.INVALID_CLEARED_STATUS}. Must be one of: ${CLEARED_STATUSES.join(', ')}`,
            400
        )
    }

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
        transaction.reconciledAt = new Date(reconciledAt)
    } else if (clearedStatus !== 'reconciled') {
        transaction.reconciledAt = null
    }

    await transaction.save()

    res.status(200).json({
        success: true,
        data: transaction,
    })
})

export const createReconciliationSession = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { accountId, statementEndDate, statementBalance } = req.body

    validateRequiredFields(req.body, ['accountId', 'statementEndDate', 'statementBalance'])

    const account = await validateResourceAccess(
        Account,
        accountId,
        userId,
        ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
        'editor'
    )

    const workspaceId = account.workspaceId ? account.workspaceId.toString() : null

    // Transfer legs can't be sign-resolved from a single record (both legs share
    // type: 'transfer' with no stored direction), so they're excluded here; only
    // income/expense transactions feed the reconciliation balance.
    const transactions = await Transaction.find({
        ...buildScopedListFilter(userId, workspaceId),
        accountId,
        type: { $ne: 'transfer' },
        date: { $lte: new Date(statementEndDate) },
    })

    // 'reconciled' transactions were cleared in a prior session and still count as settled.
    const settledTransactions = transactions.filter(
        (t) => t.clearedStatus === 'cleared' || t.clearedStatus === 'reconciled'
    )
    const pendingTransactions = transactions.filter((t) => t.clearedStatus === 'pending')

    const sumDeltas = (list: typeof transactions): number =>
        roundMoney(
            list.reduce((sum, t) => sum + getBalanceDeltaMajor(t.type, t.amount, account.type), 0)
        )

    const openingBalanceMajor =
        account.balanceUnit === 'minor' ? fromMinorUnits(account.openingBalance) : account.openingBalance
    const clearedBalance = roundMoney(openingBalanceMajor + sumDeltas(settledTransactions))
    const pendingBalance = sumDeltas(pendingTransactions)

    const balanceDifferential = roundMoney(Math.abs(statementBalance - clearedBalance))

    const session = await ReconciliationSession.create({
        userId,
        workspaceId,
        accountId,
        statementEndDate: new Date(statementEndDate),
        statementBalance,
        clearedBalance,
        pendingBalance,
        balanceDifferential,
    })

    res.status(201).json({
        success: true,
        data: session,
    })
})

export const getReconciliationSessions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { accountId } = req.params

    const account = await validateResourceAccess(
        Account,
        accountId,
        userId,
        ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
        'viewer'
    )

    const workspaceId = account.workspaceId ? account.workspaceId.toString() : null

    const sessions = await ReconciliationSession.find({
        ...buildScopedListFilter(userId, workspaceId),
        accountId,
    }).sort({ statementEndDate: -1 })

    res.status(200).json({
        success: true,
        data: sessions,
    })
})
