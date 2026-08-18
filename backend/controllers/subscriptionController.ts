import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import RecurringRule from '../models/RecurringRule'
import { AuthRequest } from '../middleware/authTypes'
import { fromMinorUnits } from '../utils/moneyUtils'
import { getUserId, handleResponses } from '../utils/sharedUtils'
import {
    computeAnnualCostMinor,
    computeMonthlyCostMinor,
    SUBSCRIPTION_ELIGIBLE_INTERVALS,
} from '../utils/subscriptionUtils'
import { assertWorkspaceMembership, buildScopedListFilter, parseOptionalWorkspaceId } from '../utils/workspaceUtils'

const formatDateOnly = (date: Date): string => date.toISOString().slice(0, 10)

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100

export const getSubscriptions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const workspaceId = parseOptionalWorkspaceId(req.query.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'viewer')
    }

    const rules = await RecurringRule.find({
        ...buildScopedListFilter(userId, workspaceId),
        type: 'expense',
        isActive: true,
        isArchived: false,
        interval: { $in: SUBSCRIPTION_ELIGIBLE_INTERVALS },
    }).sort({ nextDueDate: 1 })

    let totalMonthlyCost = 0
    let totalAnnualCost = 0

    const subscriptions = rules.map((rule) => {
        const monthlyCostMinor = computeMonthlyCostMinor(rule.amount, rule.interval)
        const annualCostMinor = computeAnnualCostMinor(rule.amount, rule.interval)

        if (!rule.isCancelled) {
            totalMonthlyCost = roundMoney(totalMonthlyCost + fromMinorUnits(monthlyCostMinor))
            totalAnnualCost = roundMoney(totalAnnualCost + fromMinorUnits(annualCostMinor))
        }

        return {
            ruleId: rule._id.toString(),
            title: rule.title,
            amount: fromMinorUnits(rule.amount),
            currency: rule.currency,
            interval: rule.interval,
            monthlyCost: fromMinorUnits(monthlyCostMinor),
            annualCost: fromMinorUnits(annualCostMinor),
            nextChargeDate: formatDateOnly(rule.nextDueDate),
            categoryId: rule.categoryId.toString(),
            accountId: rule.accountId.toString(),
            isCancelled: rule.isCancelled,
        }
    })

    handleResponses(res, 200, { subscriptions, totalMonthlyCost, totalAnnualCost })
})
