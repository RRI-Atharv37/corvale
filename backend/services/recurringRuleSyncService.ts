import { Types } from 'mongoose'

import RecurringRule, { IRecurringRule } from '../models/RecurringRule'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { parseSupportedCurrency } from '@core/money/currencyUtils'
import {
    parseCustomIntervalDays,
    parseInterval,
    parseNextDueDate,
    parseRecurringAmount,
    parseTransactionType,
    validateRuleReferences,
} from '../utils/recurringRuleUtils'
import { assertWorkspaceMembership, parseOptionalWorkspaceId, validateResourceAccess } from '@core/access/workspace'
import { archiveEntityForOp, DeleteOpOutcome, getUserTimezoneForOp } from './syncEntityHelpers'
import { fromMinorUnits } from '@shared/money'
import { isDuplicateKeyError, resolveClientObjectId } from '@core/db/objectId'
import { validateRequiredFields } from '@core/http/validation'

/**
 * `parseRecurringAmount` expects a REST body's major-unit decimal and
 * converts it to minor units itself. Sync payloads carry `amount` already in
 * minor units (the local SQLite/RecurringRule schema convention) — mirrors
 * the `transaction.create` conversion already in `syncController.ts`'s
 * `applyCreateOp`, applied here for the same reason.
 */
const toMajorAmount = (value: unknown): unknown => (typeof value === 'number' ? fromMinorUnits(value) : value)

/**
 * Sprint 13.9: create/update/delete logic for POST /sync/push, mirroring
 * recurringRuleController's createRecurringRule/updateRecurringRule/
 * archiveRecurringRule exactly. generateRecurringDrafts/confirmDraft/
 * dismissDraft stay out of scope and server-authoritative (the "Server-authoritative"
 * architecture decision) — this only covers the rule's own fields, not draft generation.
 *
 * Like category, the REST createRecurringRule endpoint predates the
 * client-generated-`_id` convention — resolveClientObjectId is added
 * here (not to the REST controller) since a sync create needs it to keep
 * the offline-created local id and the server id in sync.
 */

export const createRecurringRuleForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<IRecurringRule> => {
    validateRequiredFields(payload, [
        'title',
        'type',
        'amount',
        'accountId',
        'categoryId',
        'interval',
        'nextDueDate',
    ])

    const timezone = await getUserTimezoneForOp(userId)
    const type = parseTransactionType(payload.type)
    const amount = parseRecurringAmount(toMajorAmount(payload.amount))
    const interval = parseInterval(payload.interval)
    const customIntervalDays = parseCustomIntervalDays(interval, payload.customIntervalDays)
    const nextDueDate = parseNextDueDate(payload.nextDueDate, timezone)
    const workspaceId = parseOptionalWorkspaceId(payload.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'editor')
    }

    const { account } = await validateRuleReferences(
        userId,
        String(payload.accountId),
        String(payload.categoryId),
        workspaceId
    )

    const currency =
        payload.currency !== undefined && payload.currency !== null && payload.currency !== ''
            ? parseSupportedCurrency(payload.currency)
            : account.currency

    const clientId = resolveClientObjectId(payload._id)

    try {
        return await RecurringRule.create({
            ...(clientId ? { _id: clientId } : {}),
            userId,
            workspaceId,
            title: String(payload.title).trim(),
            type,
            amount,
            currency,
            accountId: payload.accountId,
            categoryId: payload.categoryId,
            interval,
            customIntervalDays,
            nextDueDate,
            description: typeof payload.description === 'string' ? payload.description.trim() : undefined,
            paymentMethod:
                typeof payload.paymentMethod === 'string' ? payload.paymentMethod.trim() : undefined,
            tags: Array.isArray(payload.tags) ? payload.tags.map(String) : undefined,
            isActive: payload.isActive !== false,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('A recurring rule with this id already exists', 400)
        }
        throw error
    }
}

export const updateRecurringRuleForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<IRecurringRule> => {
    const ruleId = payload._id
    if (typeof ruleId !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

    const rule = await validateResourceAccess<IRecurringRule>(
        RecurringRule,
        ruleId,
        userId,
        ERROR_MESSAGES.RECURRING.RULE_NOT_FOUND,
        'editor'
    )

    if (rule.isArchived) {
        throw new CustomError(ERROR_MESSAGES.RECURRING.RULE_ARCHIVED, 400)
    }

    const timezone = await getUserTimezoneForOp(userId)

    if (payload.title !== undefined) {
        rule.title = String(payload.title).trim()
    }

    if (payload.type !== undefined) {
        rule.type = parseTransactionType(payload.type)
    }

    if (payload.amount !== undefined) {
        rule.amount = parseRecurringAmount(toMajorAmount(payload.amount))
    }

    if (payload.currency !== undefined) {
        rule.currency = parseSupportedCurrency(payload.currency)
    }

    if (payload.accountId !== undefined || payload.categoryId !== undefined) {
        const accountId = payload.accountId ?? rule.accountId.toString()
        const categoryId = payload.categoryId ?? rule.categoryId.toString()
        await validateRuleReferences(
            userId,
            String(accountId),
            String(categoryId),
            rule.workspaceId?.toString() ?? null
        )
        if (payload.accountId !== undefined) {
            rule.accountId = new Types.ObjectId(String(accountId))
        }
        if (payload.categoryId !== undefined) {
            rule.categoryId = new Types.ObjectId(String(categoryId))
        }
    }

    if (payload.interval !== undefined) {
        rule.interval = parseInterval(payload.interval)
    }

    if (payload.customIntervalDays !== undefined || payload.interval !== undefined) {
        rule.customIntervalDays = parseCustomIntervalDays(
            rule.interval,
            payload.customIntervalDays ?? rule.customIntervalDays
        )
    }

    if (payload.nextDueDate !== undefined) {
        rule.nextDueDate = parseNextDueDate(payload.nextDueDate, timezone)
    }

    if (payload.description !== undefined) {
        rule.description = typeof payload.description === 'string' ? payload.description.trim() : undefined
    }

    if (payload.paymentMethod !== undefined) {
        rule.paymentMethod =
            typeof payload.paymentMethod === 'string' ? payload.paymentMethod.trim() : undefined
    }

    if (payload.tags !== undefined) {
        rule.tags = Array.isArray(payload.tags) ? payload.tags.map(String) : undefined
    }

    if (payload.isActive !== undefined) {
        rule.isActive = payload.isActive === true
    }

    if (payload.isCancelled !== undefined) {
        rule.isCancelled = payload.isCancelled === true
    }

    return rule.save()
}

export const deleteRecurringRuleForOp = (
    userId: string,
    payload: Record<string, unknown>
): Promise<DeleteOpOutcome> =>
    archiveEntityForOp(
        RecurringRule,
        userId,
        payload,
        ERROR_MESSAGES.RECURRING.RULE_NOT_FOUND,
        (doc) => doc.isArchived,
        (doc) => {
            doc.isArchived = true
            doc.isActive = false
        }
    )
