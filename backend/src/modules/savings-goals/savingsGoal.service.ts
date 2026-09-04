import { Types } from 'mongoose'

import SavingsGoal, { IAutoContribution, ISavingsGoal } from './savingsGoal.model'
import SavingsGoalContribution, {
    ISavingsGoalContribution,
} from './savingsGoalContribution.model'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    SerializedSavingsGoal,
    assertGoalAcceptsContributions,
    isAutoContributionDue,
    markGoalCompletedIfTargetMet,
    parseAutoContributionFromBody,
    serializeContribution,
    serializeSavingsGoal,
    serializeSavingsGoals,
    validateAccountForGoal,
} from './savingsGoalUtils'
import { buildScopedListFilter } from '@core/access/workspace'
import { isDuplicateKeyError } from '@core/db/objectId'
import { evaluateSavingsMilestoneNotifications } from '@modules/notifications/notificationUtils'
import { assertWorkspaceMembership, validateResourceAccess } from '@modules/workspaces/access'

const loadGoal = (
    goalId: string,
    userId: string,
    minRole: 'viewer' | 'editor'
): Promise<ISavingsGoal> =>
    validateResourceAccess<ISavingsGoal>(
        SavingsGoal,
        goalId,
        userId,
        ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_FOUND,
        minRole
    )

const recordContribution = async (
    goal: ISavingsGoal,
    userId: string,
    amountMinor: number,
    type: 'manual' | 'automatic',
    note?: string
): Promise<ISavingsGoalContribution> => {
    const previousAmountMinor = goal.currentAmount

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

    await evaluateSavingsMilestoneNotifications(userId, goal, previousAmountMinor)

    return contribution
}

export interface CreateSavingsGoalInput {
    userId: string
    timezone: string
    workspaceId: string | null
    name: string
    targetAmountMinor: number
    currency?: string
    targetDate: Date | null | undefined
    accountId: Types.ObjectId | null | undefined
    autoContribution?: IAutoContribution
    clientId: Types.ObjectId | null
}

export const createSavingsGoal = async (
    input: CreateSavingsGoalInput
): Promise<SerializedSavingsGoal> => {
    if (input.workspaceId) {
        await assertWorkspaceMembership(input.workspaceId, input.userId, 'editor')
    }

    if (input.accountId) {
        await validateAccountForGoal(
            input.accountId.toString(),
            input.userId,
            input.workspaceId
        )
    }

    let goal: ISavingsGoal
    try {
        goal = await SavingsGoal.create({
            ...(input.clientId ? { _id: input.clientId } : {}),
            userId: input.userId,
            workspaceId: input.workspaceId,
            name: input.name,
            targetAmount: input.targetAmountMinor,
            currency: input.currency,
            targetDate: input.targetDate ?? null,
            accountId: input.accountId ?? null,
            autoContribution:
                input.autoContribution ?? { enabled: false, amount: 0, interval: 'monthly' },
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('A savings goal with this id already exists', 400)
        }
        throw error
    }

    return serializeSavingsGoal(goal, input.timezone)
}

export interface ListSavingsGoalsInput {
    userId: string
    timezone: string
    workspaceId: string | null
    includeArchived: boolean
    status?: string
}

export const listSavingsGoals = async (
    input: ListSavingsGoalsInput
): Promise<SerializedSavingsGoal[]> => {
    if (input.workspaceId) {
        await assertWorkspaceMembership(input.workspaceId, input.userId, 'viewer')
    }

    const filter: Record<string, unknown> = buildScopedListFilter(input.userId, input.workspaceId)
    if (!input.includeArchived) {
        filter.status = { $ne: 'archived' }
    }
    if (typeof input.status === 'string' && input.status.trim()) {
        filter.status = input.status.trim()
    }

    const goals = await SavingsGoal.find(filter).sort({ createdAt: -1 })
    return serializeSavingsGoals(goals, input.timezone)
}

export const getSavingsGoal = async (
    goalId: string,
    userId: string,
    timezone: string
): Promise<SerializedSavingsGoal> => {
    const goal = await loadGoal(goalId, userId, 'viewer')
    return serializeSavingsGoal(goal, timezone)
}

export const getSavingsGoalProgress = async (
    goalId: string,
    userId: string,
    timezone: string
) => {
    const goal = await loadGoal(goalId, userId, 'viewer')
    const serialized = await serializeSavingsGoal(goal, timezone)
    return serialized.progress
}

export interface UpdateSavingsGoalInput {
    goalId: string
    userId: string
    timezone: string
    name?: string
    targetAmountMinor?: number
    currency?: string
    /** `undefined` = leave unchanged; `null` = clear; a Date = set. */
    targetDate?: Date | null
    accountId?: Types.ObjectId | null
    /** The raw `body.autoContribution` value — resolved against the stored goal here. */
    autoContributionRaw: unknown
}

export const updateSavingsGoal = async (
    input: UpdateSavingsGoalInput
): Promise<SerializedSavingsGoal> => {
    const goal = await loadGoal(input.goalId, input.userId, 'editor')

    if (goal.status === 'archived') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_ARCHIVED, 400)
    }

    if (input.name !== undefined) {
        goal.name = input.name
    }

    if (input.targetAmountMinor !== undefined) {
        goal.targetAmount = input.targetAmountMinor
        if (goal.status === 'completed' && goal.currentAmount < goal.targetAmount) {
            goal.status = 'active'
            goal.completedAt = null
        }
        markGoalCompletedIfTargetMet(goal)
    }

    if (input.currency !== undefined) {
        goal.currency = input.currency
    }

    if (input.targetDate !== undefined) {
        goal.targetDate = input.targetDate
    }

    if (input.accountId !== undefined) {
        if (input.accountId) {
            await validateAccountForGoal(
                input.accountId.toString(),
                input.userId,
                goal.workspaceId?.toString() ?? null
            )
        }
        goal.accountId = input.accountId
    }

    const nextAutoContribution = parseAutoContributionFromBody(
        { autoContribution: input.autoContributionRaw },
        goal.autoContribution
    )
    if (nextAutoContribution !== undefined) {
        goal.autoContribution = nextAutoContribution
    }

    const updated = await goal.save()
    return serializeSavingsGoal(updated, input.timezone)
}

export const archiveSavingsGoal = async (
    goalId: string,
    userId: string
): Promise<ISavingsGoal> => {
    const goal = await loadGoal(goalId, userId, 'editor')

    if (goal.status === 'archived') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_ALREADY_ARCHIVED, 400)
    }

    goal.status = 'archived'
    await goal.save()
    return goal
}

export const pauseSavingsGoal = async (
    goalId: string,
    userId: string,
    timezone: string
): Promise<SerializedSavingsGoal> => {
    const goal = await loadGoal(goalId, userId, 'editor')

    if (goal.status === 'archived' || goal.status === 'completed') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.INVALID_STATUS_TRANSITION, 400)
    }
    if (goal.status === 'paused') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_ALREADY_PAUSED, 400)
    }

    goal.status = 'paused'
    await goal.save()
    return serializeSavingsGoal(goal, timezone)
}

export const resumeSavingsGoal = async (
    goalId: string,
    userId: string,
    timezone: string
): Promise<SerializedSavingsGoal> => {
    const goal = await loadGoal(goalId, userId, 'editor')

    if (goal.status !== 'paused') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_PAUSED, 400)
    }

    goal.status = 'active'
    markGoalCompletedIfTargetMet(goal)
    await goal.save()
    return serializeSavingsGoal(goal, timezone)
}

export const completeSavingsGoal = async (
    goalId: string,
    userId: string,
    timezone: string
): Promise<SerializedSavingsGoal> => {
    const goal = await loadGoal(goalId, userId, 'editor')

    if (goal.status === 'archived') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_ARCHIVED, 400)
    }
    if (goal.status === 'completed') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_ALREADY_COMPLETED, 400)
    }

    goal.status = 'completed'
    goal.completedAt = new Date()
    await goal.save()
    return serializeSavingsGoal(goal, timezone)
}

interface ContributionResult {
    goal: SerializedSavingsGoal
    contribution: ReturnType<typeof serializeContribution>
}

export const contributeToSavingsGoal = async (input: {
    goalId: string
    userId: string
    timezone: string
    amountMinor: number
    note?: string
}): Promise<ContributionResult> => {
    const goal = await loadGoal(input.goalId, input.userId, 'editor')
    assertGoalAcceptsContributions(goal)

    const contribution = await recordContribution(
        goal,
        input.userId,
        input.amountMinor,
        'manual',
        input.note
    )
    const refreshedGoal = await SavingsGoal.findById(goal._id)
    const serialized = await serializeSavingsGoal(refreshedGoal!, input.timezone)

    return { goal: serialized, contribution: serializeContribution(contribution) }
}

export const processAutoContribution = async (input: {
    goalId: string
    userId: string
    timezone: string
}): Promise<ContributionResult> => {
    const goal = await loadGoal(input.goalId, input.userId, 'editor')
    assertGoalAcceptsContributions(goal)

    if (!goal.autoContribution.enabled || goal.autoContribution.amount <= 0) {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.AUTO_CONTRIBUTION_DISABLED, 400)
    }

    if (!isAutoContributionDue(goal.autoContribution, input.timezone)) {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.AUTO_CONTRIBUTION_NOT_DUE, 400)
    }

    const contribution = await recordContribution(
        goal,
        input.userId,
        goal.autoContribution.amount,
        'automatic'
    )
    const refreshedGoal = await SavingsGoal.findById(goal._id)
    const serialized = await serializeSavingsGoal(refreshedGoal!, input.timezone)

    return { goal: serialized, contribution: serializeContribution(contribution) }
}

export const getContributionHistory = async (goalId: string, userId: string) => {
    await loadGoal(goalId, userId, 'viewer')

    const contributions = await SavingsGoalContribution.find({ goalId, userId }).sort({
        contributedAt: -1,
    })
    return contributions.map((entry) => serializeContribution(entry))
}
