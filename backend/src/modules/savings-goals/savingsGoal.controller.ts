import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { parseOptionalSupportedCurrency, parseSupportedCurrency } from '@core/money/currencyUtils'
import { DEFAULT_TIMEZONE } from '@core/time/timezoneUtils'
import {
    parseAutoContributionFromBody,
    parseGoalAmount,
    parseOptionalGoalAmount,
    parseOptionalTargetDate,
} from './savingsGoalUtils'
import { parseOptionalWorkspaceId } from '@core/access/workspace'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { resolveClientObjectId } from '@core/db/objectId'
import { validateRequiredFields } from '@core/http/validation'
import {
    archiveSavingsGoal as archiveSavingsGoalService,
    completeSavingsGoal as completeSavingsGoalService,
    contributeToSavingsGoal as contributeToSavingsGoalService,
    createSavingsGoal as createSavingsGoalService,
    getContributionHistory as getContributionHistoryService,
    getSavingsGoal as getSavingsGoalService,
    getSavingsGoalProgress as getSavingsGoalProgressService,
    listSavingsGoals as listSavingsGoalsService,
    pauseSavingsGoal as pauseSavingsGoalService,
    processAutoContribution as processAutoContributionService,
    resumeSavingsGoal as resumeSavingsGoalService,
    updateSavingsGoal as updateSavingsGoalService,
} from './savingsGoal.service'

const getUserTimezone = (req: AuthRequest): string =>
    req.user?.timezone?.trim() || DEFAULT_TIMEZONE

const parseOptionalAccountId = (accountId: unknown): Types.ObjectId | null | undefined => {
    if (accountId === undefined) {
        return undefined
    }
    if (accountId === null || accountId === '') {
        return null
    }
    if (typeof accountId !== 'string') {
        throw new CustomError('accountId must be a string or null', 400)
    }
    return new Types.ObjectId(accountId)
}

const parseGoalName = (value: unknown): string => {
    const name = String(value).trim()
    if (!name) {
        throw new CustomError('Goal name cannot be empty', 400)
    }
    return name
}

export const createSavingsGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const timezone = getUserTimezone(req)
    validateRequiredFields(req.body, ['name', 'targetAmount'])

    const serialized = await createSavingsGoalService({
        userId: getUserId(req),
        timezone,
        workspaceId: parseOptionalWorkspaceId(req.body.workspaceId) ?? null,
        name: String(req.body.name).trim(),
        targetAmountMinor: parseGoalAmount(req.body.targetAmount),
        currency: parseOptionalSupportedCurrency(req.body.currency),
        targetDate: parseOptionalTargetDate(req.body.targetDate, timezone),
        accountId: parseOptionalAccountId(req.body.accountId),
        autoContribution: parseAutoContributionFromBody(req.body),
        clientId: resolveClientObjectId(req.body._id) ?? null,
    })

    handleResponses(res, 201, serialized)
})

export const getSavingsGoals = asyncHandler(async (req: AuthRequest, res: Response) => {
    const serialized = await listSavingsGoalsService({
        userId: getUserId(req),
        timezone: getUserTimezone(req),
        workspaceId: parseOptionalWorkspaceId(req.query.workspaceId) ?? null,
        includeArchived: req.query.includeArchived === 'true',
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
    })

    handleResponses(res, 200, serialized)
})

export const getSavingsGoalById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { goalId } = req.params
    validateRequiredFields({ goalId }, ['goalId'])

    handleResponses(
        res,
        200,
        await getSavingsGoalService(goalId, getUserId(req), getUserTimezone(req))
    )
})

export const updateSavingsGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const timezone = getUserTimezone(req)
    const { goalId } = req.params
    validateRequiredFields({ goalId }, ['goalId'])

    const serialized = await updateSavingsGoalService({
        goalId,
        userId: getUserId(req),
        timezone,
        name: req.body.name !== undefined ? parseGoalName(req.body.name) : undefined,
        targetAmountMinor:
            req.body.targetAmount !== undefined
                ? parseGoalAmount(req.body.targetAmount)
                : undefined,
        currency:
            req.body.currency !== undefined
                ? parseSupportedCurrency(req.body.currency)
                : undefined,
        targetDate: parseOptionalTargetDate(req.body.targetDate, timezone),
        accountId: parseOptionalAccountId(req.body.accountId),
        autoContributionRaw: req.body.autoContribution,
    })

    handleResponses(res, 200, serialized)
})

export const archiveSavingsGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { goalId } = req.params
    validateRequiredFields({ goalId }, ['goalId'])

    const goal = await archiveSavingsGoalService(goalId, getUserId(req))
    handleResponses(res, 200, { message: 'Savings goal archived successfully', data: goal })
})

export const pauseSavingsGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { goalId } = req.params
    validateRequiredFields({ goalId }, ['goalId'])

    handleResponses(
        res,
        200,
        await pauseSavingsGoalService(goalId, getUserId(req), getUserTimezone(req))
    )
})

export const resumeSavingsGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { goalId } = req.params
    validateRequiredFields({ goalId }, ['goalId'])

    handleResponses(
        res,
        200,
        await resumeSavingsGoalService(goalId, getUserId(req), getUserTimezone(req))
    )
})

export const completeSavingsGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { goalId } = req.params
    validateRequiredFields({ goalId }, ['goalId'])

    handleResponses(
        res,
        200,
        await completeSavingsGoalService(goalId, getUserId(req), getUserTimezone(req))
    )
})

export const getSavingsGoalProgress = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { goalId } = req.params
    validateRequiredFields({ goalId }, ['goalId'])

    handleResponses(
        res,
        200,
        await getSavingsGoalProgressService(goalId, getUserId(req), getUserTimezone(req))
    )
})

export const contributeToSavingsGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { goalId } = req.params
    validateRequiredFields({ goalId, ...req.body }, ['goalId', 'amount'])

    const note =
        typeof req.body.note === 'string' ? req.body.note.trim() || undefined : undefined

    const result = await contributeToSavingsGoalService({
        goalId,
        userId: getUserId(req),
        timezone: getUserTimezone(req),
        amountMinor: parseOptionalGoalAmount(req.body.amount),
        note,
    })

    handleResponses(res, 200, {
        message: 'Contribution recorded successfully',
        data: result,
    })
})

export const processAutoContribution = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { goalId } = req.params
    validateRequiredFields({ goalId }, ['goalId'])

    const result = await processAutoContributionService({
        goalId,
        userId: getUserId(req),
        timezone: getUserTimezone(req),
    })

    handleResponses(res, 200, {
        message: 'Automatic contribution processed successfully',
        data: result,
    })
})

export const getContributionHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { goalId } = req.params
    validateRequiredFields({ goalId }, ['goalId'])

    handleResponses(res, 200, await getContributionHistoryService(goalId, getUserId(req)))
})
