import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import Account, { IAccount } from '../models/Account'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { DebtInput, generatePayoffSchedule, PayoffStrategy } from '../utils/debtPayoffUtils'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { toMinorUnits } from '../utils/moneyUtils'
import { getUserId, handleResponses } from '../utils/sharedUtils'
import { assertWorkspaceMembership, buildScopedListFilter, parseOptionalWorkspaceId, validateResourceAccess } from '../utils/workspaceUtils'

const parseStrategy = (value: unknown): PayoffStrategy => {
    if (value !== 'snowball' && value !== 'avalanche') {
        throw new CustomError("Invalid strategy; must be 'snowball' or 'avalanche'", 400)
    }
    return value
}

const parseExtraPayment = (value: unknown): number => {
    const parsed = Number(value)
    if (isNaN(parsed) || parsed < 0) {
        throw new CustomError('Invalid extraPayment; must be a non-negative number', 400)
    }
    return parsed
}

const isEligibleDebtAccount = (account: IAccount): boolean => {
    return account.type === 'credit' && account.currentBalance < 0
}

const buildDebtInput = (account: IAccount): DebtInput => {
    if (account.interestRate === undefined || account.minimumPayment === undefined) {
        throw new CustomError(
            `Account "${account.name}" must have interestRate and minimum payment configured before planning payoff`,
            400
        )
    }

    return {
        accountId: account._id.toString(),
        balanceMinor: toMinorUnits(Math.abs(account.currentBalance)),
        interestRate: account.interestRate,
        minimumPaymentMinor: toMinorUnits(account.minimumPayment),
    }
}

export const planDebtPayoff = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const strategy = parseStrategy(req.body.strategy)
    const extraPayment = parseExtraPayment(req.body.extraPayment)
    const workspaceId = parseOptionalWorkspaceId(req.body.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'viewer')
    }

    let accounts: IAccount[]

    if (Array.isArray(req.body.accountIds) && req.body.accountIds.length > 0) {
        accounts = await Promise.all(
            req.body.accountIds.map((id: string) =>
                validateResourceAccess(
                    Account,
                    id,
                    userId,
                    ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
                    'viewer'
                )
            )
        )
        accounts = accounts.filter(isEligibleDebtAccount)
    } else {
        accounts = await Account.find({
            ...buildScopedListFilter(userId, workspaceId),
            isArchived: false,
            type: 'credit',
            currentBalance: { $lt: 0 },
        })
    }

    const debts = accounts.map(buildDebtInput)
    const extraPaymentMinor = toMinorUnits(extraPayment)

    if (debts.length === 0) {
        handleResponses(res, 200, {
            strategy,
            extraPayment,
            order: [],
            totalMonths: 0,
            totalInterestPaid: 0,
            months: [],
        })
        return
    }

    const plan = generatePayoffSchedule(debts, extraPaymentMinor, strategy)

    handleResponses(res, 200, {
        strategy,
        extraPayment,
        order: plan.order,
        totalMonths: plan.totalMonths,
        totalInterestPaid: plan.totalInterestPaid,
        months: plan.months,
    })
})
