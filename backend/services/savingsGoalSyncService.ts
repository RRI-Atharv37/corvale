import { Types } from 'mongoose'

import SavingsGoal, { ISavingsGoal } from '../models/SavingsGoal'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { parseOptionalSupportedCurrency, parseSupportedCurrency } from '../utils/currencyUtils'
import {
    markGoalCompletedIfTargetMet,
    parseAutoContributionFromBody,
    parseGoalAmount,
    parseOptionalTargetDate,
    validateAccountForGoal,
} from '../utils/savingsGoalUtils'
import { isDuplicateKeyError, resolveClientObjectId, validateRequiredFields } from '../utils/sharedUtils'
import { assertWorkspaceMembership, parseOptionalWorkspaceId, validateResourceAccess } from '../utils/workspaceUtils'
import { archiveEntityForOp, DeleteOpOutcome, getUserTimezoneForOp } from './syncEntityHelpers'
import { fromMinorUnits } from '@shared/money'

/**
 * `parseGoalAmount` (used for both `targetAmount` and the nested
 * `autoContribution.amount`) expects a REST body's major-unit decimal and
 * converts it to minor units itself. Sync payloads carry these already in
 * minor units (the local SQLite/SavingsGoal schema convention) — mirrors the
 * `transaction.create` conversion already in `syncController.ts`'s
 * `applyCreateOp`, applied here for the same reason.
 */
const toMajorAmount = (value: unknown): unknown => (typeof value === 'number' ? fromMinorUnits(value) : value)

const withMajorUnitAmounts = (payload: Record<string, unknown>): Record<string, unknown> => {
    const converted: Record<string, unknown> = { ...payload }
    if (converted.targetAmount !== undefined) {
        converted.targetAmount = toMajorAmount(converted.targetAmount)
    }
    if (converted.autoContribution && typeof converted.autoContribution === 'object') {
        const autoContribution = converted.autoContribution as Record<string, unknown>
        if (autoContribution.amount !== undefined) {
            converted.autoContribution = { ...autoContribution, amount: toMajorAmount(autoContribution.amount) }
        }
    }
    return converted
}

/**
 * Sprint 13.9: create/update/delete logic for POST /sync/push, mirroring
 * savingsGoalController's createSavingsGoal/updateSavingsGoal/
 * archiveSavingsGoal exactly. Only create/update/archive are in scope here
 * — pause/resume/complete/contribute/processAutoContribution stay
 * server-authoritative REST-only actions per the sprint's design (they have
 * server-computed side effects, not raw field edits).
 */

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

export const createSavingsGoalForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<ISavingsGoal> => {
    validateRequiredFields(payload, ['name', 'targetAmount'])
    payload = withMajorUnitAmounts(payload)

    const timezone = await getUserTimezoneForOp(userId)
    const targetAmount = parseGoalAmount(payload.targetAmount)
    const targetDate = parseOptionalTargetDate(payload.targetDate, timezone)
    const currency = parseOptionalSupportedCurrency(payload.currency)
    const accountObjectId = parseOptionalAccountId(payload.accountId)
    const workspaceId = parseOptionalWorkspaceId(payload.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'editor')
    }

    if (accountObjectId) {
        await validateAccountForGoal(accountObjectId.toString(), userId, workspaceId)
    }

    const autoContribution = parseAutoContributionFromBody(payload)
    const clientId = resolveClientObjectId(payload._id)

    try {
        return await SavingsGoal.create({
            ...(clientId ? { _id: clientId } : {}),
            userId,
            workspaceId,
            name: String(payload.name).trim(),
            targetAmount,
            currency,
            targetDate: targetDate ?? null,
            accountId: accountObjectId ?? null,
            autoContribution: autoContribution ?? { enabled: false, amount: 0, interval: 'monthly' },
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('A savings goal with this id already exists', 400)
        }
        throw error
    }
}

export const updateSavingsGoalForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<ISavingsGoal> => {
    const goalId = payload._id
    if (typeof goalId !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

    const goal = await validateResourceAccess<ISavingsGoal>(
        SavingsGoal,
        goalId,
        userId,
        ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_FOUND,
        'editor'
    )

    if (goal.status === 'archived') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_ARCHIVED, 400)
    }

    payload = withMajorUnitAmounts(payload)
    const timezone = await getUserTimezoneForOp(userId)

    if (payload.name !== undefined) {
        const name = String(payload.name).trim()
        if (!name) {
            throw new CustomError('Goal name cannot be empty', 400)
        }
        goal.name = name
    }

    if (payload.targetAmount !== undefined) {
        goal.targetAmount = parseGoalAmount(payload.targetAmount)
        if (goal.status === 'completed' && goal.currentAmount < goal.targetAmount) {
            goal.status = 'active'
            goal.completedAt = null
        }
        markGoalCompletedIfTargetMet(goal)
    }

    if (payload.currency !== undefined) {
        goal.currency = parseSupportedCurrency(payload.currency)
    }

    const targetDate = parseOptionalTargetDate(payload.targetDate, timezone)
    if (targetDate !== undefined) {
        goal.targetDate = targetDate
    }

    const accountObjectId = parseOptionalAccountId(payload.accountId)
    if (accountObjectId !== undefined) {
        if (accountObjectId) {
            await validateAccountForGoal(
                accountObjectId.toString(),
                userId,
                goal.workspaceId?.toString() ?? null
            )
        }
        goal.accountId = accountObjectId
    }

    const autoContribution = parseAutoContributionFromBody(payload, goal.autoContribution)
    if (autoContribution !== undefined) {
        goal.autoContribution = autoContribution
    }

    return goal.save()
}

export const deleteSavingsGoalForOp = (
    userId: string,
    payload: Record<string, unknown>
): Promise<DeleteOpOutcome> =>
    archiveEntityForOp(
        SavingsGoal,
        userId,
        payload,
        ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_FOUND,
        (doc) => doc.status === 'archived',
        (doc) => {
            doc.status = 'archived'
        }
    )
