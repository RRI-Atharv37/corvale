import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { CLEARED_STATUSES } from '@modules/transactions'
import { roundMoney, parseSignedMajorAmount } from '@core/money/moneyUtils'
import { isObjectIdString } from '@core/db/objectId'
import { getUserId } from '@core/auth/requestUser'
import { validateRequiredFields } from '@core/http/validation'
import { createSession, isClearedStatus, listSessions, setClearedStatus } from './reconciliation.service'

const parseDate = (value: unknown, message: string): Date => {
    const parsed = typeof value === 'string' || typeof value === 'number' ? new Date(value) : null
    if (!parsed || isNaN(parsed.getTime())) {
        throw new CustomError(message, 400)
    }
    return parsed
}

export const updateClearedStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { transactionId } = req.params
    const { clearedStatus, reconciledAt } = req.body

    validateRequiredFields(req.body, ['clearedStatus'])

    if (!isClearedStatus(clearedStatus)) {
        throw new CustomError(
            `${ERROR_MESSAGES.RECONCILIATION.INVALID_CLEARED_STATUS}. Must be one of: ${CLEARED_STATUSES.join(', ')}`,
            400
        )
    }

    const transaction = await setClearedStatus({
        userId,
        transactionId,
        clearedStatus,
        reconciledAt: reconciledAt
            ? parseDate(reconciledAt, ERROR_MESSAGES.RECONCILIATION.INVALID_RECONCILED_AT)
            : null,
    })

    res.status(200).json({
        success: true,
        data: transaction,
    })
})

export const createReconciliationSession = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { accountId, statementEndDate, statementBalance } = req.body

    validateRequiredFields(req.body, ['accountId', 'statementEndDate', 'statementBalance'])

    if (!isObjectIdString(accountId)) {
        throw new CustomError(ERROR_MESSAGES.RECONCILIATION.INVALID_ACCOUNT_ID, 400)
    }

    let balance: number
    try {
        balance = roundMoney(parseSignedMajorAmount(statementBalance))
    } catch {
        throw new CustomError(ERROR_MESSAGES.RECONCILIATION.INVALID_STATEMENT_BALANCE, 400)
    }

    const session = await createSession({
        userId,
        accountId,
        statementEndDate: parseDate(statementEndDate, ERROR_MESSAGES.RECONCILIATION.INVALID_STATEMENT_DATE),
        statementBalance: balance,
    })

    res.status(201).json({
        success: true,
        data: session,
    })
})

export const getReconciliationSessions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const sessions = await listSessions(getUserId(req), req.params.accountId)

    res.status(200).json({
        success: true,
        data: sessions,
    })
})
