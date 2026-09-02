import { Types } from 'mongoose'

import CategorizationRule, { ICategorizationRule } from '../models/CategorizationRule'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    parseMatchType,
    parseOptionalAmountBound,
    parsePriority,
    parseRuleTags,
    validateRuleCriteria,
} from '../utils/categorizationRuleUtils'
import { validateResourceAccess } from '@core/access/workspace'
import { DeleteOpOutcome, softDeleteEntityForOp } from './syncEntityHelpers'
import { fromMinorUnits } from '@shared/money'
import { isDuplicateKeyError, resolveClientObjectId } from '@core/db/objectId'
import { validateRequiredFields } from '@core/http/validation'

/**
 * `parseOptionalAmountBound` expects a REST body's major-unit decimal and
 * converts it to minor units itself. Sync payloads carry `amountMin`/
 * `amountMax` already in minor units (the local SQLite/CategorizationRule
 * schema convention) — mirrors the `transaction.create` conversion already
 * in `syncController.ts`'s `applyCreateOp`, applied here for the same
 * reason.
 */
const toMajorAmount = (value: unknown): unknown => (typeof value === 'number' ? fromMinorUnits(value) : value)

/**
 * Sprint 13.9: create/update/delete logic for POST /sync/push, mirroring
 * categorizationRuleController's createCategorizationRule/
 * updateCategorizationRule/deleteCategorizationRule exactly. Real
 * `deletedAt` soft-delete like Tag, so delete tombstones unconditionally.
 * bulkApplyRules/testCategorizationRule stay REST-only (not raw field
 * edits — out of scope).
 */

const validateUserRuleForOp = async (ruleId: string, userId: string): Promise<ICategorizationRule> =>
    validateResourceAccess<ICategorizationRule>(
        CategorizationRule,
        ruleId,
        userId,
        ERROR_MESSAGES.CATEGORIZATION_RULE.RULE_NOT_FOUND,
        'editor'
    )

const buildCriteriaFromBody = (body: Record<string, unknown>) => ({
    matchValue: body.matchValue !== undefined ? String(body.matchValue) : undefined,
    amountMin: parseOptionalAmountBound(toMajorAmount(body.amountMin), 'amountMin'),
    amountMax: parseOptionalAmountBound(toMajorAmount(body.amountMax), 'amountMax'),
    accountId: body.accountId !== undefined ? String(body.accountId) : undefined,
    categoryId: String(body.categoryId),
    tags: parseRuleTags(body.tags),
})

export const createCategorizationRuleForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<ICategorizationRule> => {
    validateRequiredFields(payload, ['name', 'matchType', 'categoryId'])

    const name = String(payload.name).trim()
    if (!name) {
        throw new CustomError('Rule name is required', 400)
    }

    const matchType = parseMatchType(payload.matchType)
    const criteria = buildCriteriaFromBody(payload)
    await validateRuleCriteria(userId, matchType, criteria)

    const clientId = resolveClientObjectId(payload._id)

    try {
        return await CategorizationRule.create({
            ...(clientId ? { _id: clientId } : {}),
            userId,
            name,
            matchType,
            matchValue: criteria.matchValue?.trim(),
            amountMin: criteria.amountMin,
            amountMax: criteria.amountMax,
            accountId: criteria.accountId,
            categoryId: criteria.categoryId,
            tags: criteria.tags,
            priority: parsePriority(payload.priority),
            isActive: payload.isActive !== false,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('A categorization rule with this id already exists', 400)
        }
        throw error
    }
}

export const updateCategorizationRuleForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<ICategorizationRule> => {
    const ruleId = payload._id
    if (typeof ruleId !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

    const rule = await validateUserRuleForOp(ruleId, userId)

    const nextMatchType = payload.matchType !== undefined ? parseMatchType(payload.matchType) : rule.matchType

    if (payload.name !== undefined) {
        const name = String(payload.name).trim()
        if (!name) {
            throw new CustomError('Rule name is required', 400)
        }
        rule.name = name
    }

    const criteria = {
        matchValue: payload.matchValue !== undefined ? String(payload.matchValue) : rule.matchValue,
        amountMin:
            payload.amountMin !== undefined
                ? parseOptionalAmountBound(toMajorAmount(payload.amountMin), 'amountMin')
                : rule.amountMin,
        amountMax:
            payload.amountMax !== undefined
                ? parseOptionalAmountBound(toMajorAmount(payload.amountMax), 'amountMax')
                : rule.amountMax,
        accountId: payload.accountId !== undefined ? String(payload.accountId) : rule.accountId?.toString(),
        categoryId: payload.categoryId !== undefined ? String(payload.categoryId) : rule.categoryId.toString(),
        tags: payload.tags !== undefined ? parseRuleTags(payload.tags) : rule.tags,
    }

    await validateRuleCriteria(userId, nextMatchType, criteria)

    rule.matchType = nextMatchType
    rule.matchValue =
        nextMatchType === 'description_contains' || nextMatchType === 'description_equals'
            ? criteria.matchValue?.trim()
            : undefined
    rule.amountMin = nextMatchType === 'amount_range' ? criteria.amountMin : undefined
    rule.amountMax = nextMatchType === 'amount_range' ? criteria.amountMax : undefined
    rule.accountId =
        nextMatchType === 'account_id' && criteria.accountId ? new Types.ObjectId(criteria.accountId) : undefined
    rule.categoryId = criteria.categoryId as unknown as ICategorizationRule['categoryId']
    rule.tags = criteria.tags

    if (payload.priority !== undefined) {
        rule.priority = parsePriority(payload.priority)
    }
    if (payload.isActive !== undefined) {
        rule.isActive = Boolean(payload.isActive)
    }

    return rule.save()
}

export const deleteCategorizationRuleForOp = (
    userId: string,
    payload: Record<string, unknown>
): Promise<DeleteOpOutcome> =>
    softDeleteEntityForOp(
        CategorizationRule,
        userId,
        payload,
        ERROR_MESSAGES.CATEGORIZATION_RULE.RULE_NOT_FOUND
    )
