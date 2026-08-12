import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import SavingsGoal, { ISavingsGoal } from '../models/SavingsGoal'
import SavingsGoalContribution from '../models/SavingsGoalContribution'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { parseOptionalSupportedCurrency, parseSupportedCurrency } from '../utils/currencyUtils'
import { DEFAULT_TIMEZONE } from '../utils/timezoneUtils'
import {
    assertGoalAcceptsContributions,
    isAutoContributionDue,
    markGoalCompletedIfTargetMet,
    parseAutoContributionFromBody,
    parseGoalAmount,
    parseOptionalGoalAmount,
    parseOptionalTargetDate,
    serializeContribution,
    serializeSavingsGoal,
    serializeSavingsGoals,
    validateAccountForGoal,
} from '../utils/savingsGoalUtils'
import {
    getUserId,
    handleResponses,
    validateOwnership,
    validateRequiredFields,
} from '../utils/sharedUtils'

const getUserTimezone = (req: AuthRequest): string => {
    return req.user?.timezone?.trim() || DEFAULT_TIMEZONE
}

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

const recordContribution = async (
    goal: ISavingsGoal,
    userId: string,
    amountMinor: number,
    type: 'manual' | 'automatic',
    note?: string
) => {
    const contribution = await SavingsGoalContribution.create({
        userId,
        goalId: goal._id,
        amount: amountMinor,
        type,
        note,
        contributedAt: new Date(),
    })

    goal.currentAmount += amountMinor
    if (type === 'automatic') {
        goal.autoContribution.lastContributedAt = new Date()
    }
    markGoalCompletedIfTargetMet(goal)
    await goal.save()

    return contribution
}

export const createSavingsGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)

    validateRequiredFields(req.body, ['name', 'targetAmount'])

    const targetAmount = parseGoalAmount(req.body.targetAmount)
    const targetDate = parseOptionalTargetDate(req.body.targetDate, timezone)
    const currency = parseOptionalSupportedCurrency(req.body.currency)
    const accountObjectId = parseOptionalAccountId(req.body.accountId)

    if (accountObjectId) {
        await validateAccountForGoal(accountObjectId.toString(), userId)
    }

    const autoContribution = parseAutoContributionFromBody(req.body)

    const goal = await SavingsGoal.create({
        userId,
        name: String(req.body.name).trim(),
        targetAmount,
        currency,
        targetDate: targetDate ?? null,
        accountId: accountObjectId ?? null,
        autoContribution: autoContribution ?? { enabled: false, amount: 0, interval: 'monthly' },
    })

    const serialized = await serializeSavingsGoal(goal, timezone)
    handleResponses(res, 201, serialized)
})

export const getSavingsGoals = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const includeArchived = req.query.includeArchived === 'true'

    const filter: Record<string, unknown> = { userId }
    if (!includeArchived) {
        filter.status = { $ne: 'archived' }
    }

    if (typeof req.query.status === 'string' && req.query.status.trim()) {
        filter.status = req.query.status.trim()
    }

    const goals = await SavingsGoal.find(filter).sort({ createdAt: -1 })
    const serialized = await serializeSavingsGoals(goals, timezone)
    handleResponses(res, 200, serialized)
})

export const getSavingsGoalById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { goalId } = req.params

    validateRequiredFields({ goalId }, ['goalId'])

    const goal = await validateOwnership<ISavingsGoal>(
        SavingsGoal,
        goalId,
        userId,
        ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_FOUND
    )

    const serialized = await serializeSavingsGoal(goal, timezone)
    handleResponses(res, 200, serialized)
})

export const updateSavingsGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { goalId } = req.params

    validateRequiredFields({ goalId }, ['goalId'])

    const goal = await validateOwnership<ISavingsGoal>(
        SavingsGoal,
        goalId,
        userId,
        ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_FOUND
    )

    if (goal.status === 'archived') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_ARCHIVED, 400)
    }

    if (req.body.name !== undefined) {
        const name = String(req.body.name).trim()
        if (!name) {
            throw new CustomError('Goal name cannot be empty', 400)
        }
        goal.name = name
    }

    if (req.body.targetAmount !== undefined) {
        goal.targetAmount = parseGoalAmount(req.body.targetAmount)
        if (goal.status === 'completed' && goal.currentAmount < goal.targetAmount) {
            goal.status = 'active'
            goal.completedAt = null
        }
        markGoalCompletedIfTargetMet(goal)
    }

    if (req.body.currency !== undefined) {
        goal.currency = parseSupportedCurrency(req.body.currency)
    }

    const targetDate = parseOptionalTargetDate(req.body.targetDate, timezone)
    if (targetDate !== undefined) {
        goal.targetDate = targetDate
    }

    const accountObjectId = parseOptionalAccountId(req.body.accountId)
    if (accountObjectId !== undefined) {
        if (accountObjectId) {
            await validateAccountForGoal(accountObjectId.toString(), userId)
        }
        goal.accountId = accountObjectId
    }

    const autoContribution = parseAutoContributionFromBody(req.body, goal.autoContribution)
    if (autoContribution !== undefined) {
        goal.autoContribution = autoContribution
    }

    const updatedGoal = await goal.save()
    const serialized = await serializeSavingsGoal(updatedGoal, timezone)
    handleResponses(res, 200, serialized)
})

export const archiveSavingsGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { goalId } = req.params

    validateRequiredFields({ goalId }, ['goalId'])

    const goal = await validateOwnership<ISavingsGoal>(
        SavingsGoal,
        goalId,
        userId,
        ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_FOUND
    )

    if (goal.status === 'archived') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_ALREADY_ARCHIVED, 400)
    }

    goal.status = 'archived'
    await goal.save()

    handleResponses(res, 200, { message: 'Savings goal archived successfully', data: goal })
})

export const pauseSavingsGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { goalId } = req.params

    validateRequiredFields({ goalId }, ['goalId'])

    const goal = await validateOwnership<ISavingsGoal>(
        SavingsGoal,
        goalId,
        userId,
        ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_FOUND
    )

    if (goal.status === 'archived' || goal.status === 'completed') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.INVALID_STATUS_TRANSITION, 400)
    }
    if (goal.status === 'paused') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_ALREADY_PAUSED, 400)
    }

    goal.status = 'paused'
    await goal.save()

    const serialized = await serializeSavingsGoal(goal, timezone)
    handleResponses(res, 200, serialized)
})

export const resumeSavingsGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { goalId } = req.params

    validateRequiredFields({ goalId }, ['goalId'])

    const goal = await validateOwnership<ISavingsGoal>(
        SavingsGoal,
        goalId,
        userId,
        ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_FOUND
    )

    if (goal.status !== 'paused') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_PAUSED, 400)
    }

    goal.status = 'active'
    markGoalCompletedIfTargetMet(goal)
    await goal.save()

    const serialized = await serializeSavingsGoal(goal, timezone)
    handleResponses(res, 200, serialized)
})

export const completeSavingsGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { goalId } = req.params

    validateRequiredFields({ goalId }, ['goalId'])

    const goal = await validateOwnership<ISavingsGoal>(
        SavingsGoal,
        goalId,
        userId,
        ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_FOUND
    )

    if (goal.status === 'archived') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_ARCHIVED, 400)
    }
    if (goal.status === 'completed') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_ALREADY_COMPLETED, 400)
    }

    goal.status = 'completed'
    goal.completedAt = new Date()
    await goal.save()

    const serialized = await serializeSavingsGoal(goal, timezone)
    handleResponses(res, 200, serialized)
})

export const getSavingsGoalProgress = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { goalId } = req.params

    validateRequiredFields({ goalId }, ['goalId'])

    const goal = await validateOwnership<ISavingsGoal>(
        SavingsGoal,
        goalId,
        userId,
        ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_FOUND
    )

    const serialized = await serializeSavingsGoal(goal, timezone)
    handleResponses(res, 200, serialized.progress)
})

export const contributeToSavingsGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { goalId } = req.params

    validateRequiredFields({ goalId, ...req.body }, ['goalId', 'amount'])

    const goal = await validateOwnership<ISavingsGoal>(
        SavingsGoal,
        goalId,
        userId,
        ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_FOUND
    )

    assertGoalAcceptsContributions(goal)

    const amountMinor = parseOptionalGoalAmount(req.body.amount)
    const note = typeof req.body.note === 'string' ? req.body.note.trim() || undefined : undefined

    const contribution = await recordContribution(goal, userId, amountMinor, 'manual', note)
    const refreshedGoal = await SavingsGoal.findById(goal._id)
    const serialized = await serializeSavingsGoal(refreshedGoal!, timezone)

    handleResponses(res, 200, {
        message: 'Contribution recorded successfully',
        data: {
            goal: serialized,
            contribution: serializeContribution(contribution),
        },
    })
})

export const processAutoContribution = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { goalId } = req.params

    validateRequiredFields({ goalId }, ['goalId'])

    const goal = await validateOwnership<ISavingsGoal>(
        SavingsGoal,
        goalId,
        userId,
        ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_FOUND
    )

    assertGoalAcceptsContributions(goal)

    if (!goal.autoContribution.enabled || goal.autoContribution.amount <= 0) {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.AUTO_CONTRIBUTION_DISABLED, 400)
    }

    if (!isAutoContributionDue(goal.autoContribution, timezone)) {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.AUTO_CONTRIBUTION_NOT_DUE, 400)
    }

    const contribution = await recordContribution(
        goal,
        userId,
        goal.autoContribution.amount,
        'automatic'
    )
    const refreshedGoal = await SavingsGoal.findById(goal._id)
    const serialized = await serializeSavingsGoal(refreshedGoal!, timezone)

    handleResponses(res, 200, {
        message: 'Automatic contribution processed successfully',
        data: {
            goal: serialized,
            contribution: serializeContribution(contribution),
        },
    })
})

export const getContributionHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { goalId } = req.params

    validateRequiredFields({ goalId }, ['goalId'])

    await validateOwnership<ISavingsGoal>(
        SavingsGoal,
        goalId,
        userId,
        ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_FOUND
    )

    const contributions = await SavingsGoalContribution.find({ goalId, userId }).sort({
        contributedAt: -1,
    })

    handleResponses(
        res,
        200,
        contributions.map((entry) => serializeContribution(entry))
    )
})
