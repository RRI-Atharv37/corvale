import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { IAccount, Account } from '@modules/accounts'
import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { DebtInput, generatePayoffSchedule, PayoffStrategy } from './debtPayoffUtils'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { toMinorUnits } from '@core/money/moneyUtils'
import { buildScopedListFilter, parseOptionalWorkspaceId } from '@core/access/workspace'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { assertWorkspaceMembership, validateResourceAccess } from "@modules/workspaces/access";

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

    // account.currentBalance is already minor units for a migrated (balanceUnit: 'minor')
    // account (Sprint C5) — converting it again here would double-scale by 100x.
    const balanceMinor =
        account.balanceUnit === 'minor'
            ? Math.abs(account.currentBalance)
            : toMinorUnits(Math.abs(account.currentBalance))

    return {
        accountId: account._id.toString(),
        balanceMinor,
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
