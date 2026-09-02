import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import CategorizationRule, { ICategorizationRule } from './categorizationRule.model'
import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    applyCategorizationRules,
    bulkApplyCategorizationRules,
    parseMatchType,
    parseOptionalAmountBound,
    parsePriority,
    parseRuleTags,
    serializeCategorizationRule,
    validateRuleCriteria,
} from './categorizationRuleUtils'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { isDuplicateKeyError, resolveClientObjectId } from '@core/db/objectId'
import { validateRequiredFields } from '@core/http/validation'
import { parseClientAmount } from "@modules/transactions/transactionUtils";

const validateUserRule = async (ruleId: string, userId: string): Promise<ICategorizationRule> => {
    const rule = await CategorizationRule.findById(ruleId)
    if (!rule) {
        throw new CustomError(ERROR_MESSAGES.CATEGORIZATION_RULE.RULE_NOT_FOUND, 404)
    }

    if (rule.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    return rule
}

const buildCriteriaFromBody = (body: Record<string, unknown>) => ({
    matchValue: body.matchValue !== undefined ? String(body.matchValue) : undefined,
    amountMin: parseOptionalAmountBound(body.amountMin, 'amountMin'),
    amountMax: parseOptionalAmountBound(body.amountMax, 'amountMax'),
    accountId: body.accountId !== undefined ? String(body.accountId) : undefined,
    categoryId: String(body.categoryId),
    tags: parseRuleTags(body.tags),
})

export const createCategorizationRule = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    validateRequiredFields(req.body, ['name', 'matchType', 'categoryId'])

    const name = String(req.body.name).trim()
    if (!name) {
        throw new CustomError('Rule name is required', 400)
    }

    const matchType = parseMatchType(req.body.matchType)
    const criteria = buildCriteriaFromBody(req.body)
    await validateRuleCriteria(userId, matchType, criteria)

    const clientId = resolveClientObjectId(req.body._id)

    let rule
    try {
        rule = await CategorizationRule.create({
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
            priority: parsePriority(req.body.priority),
            isActive: req.body.isActive !== false,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('A categorization rule with this id already exists', 400)
        }
        throw error
    }

    handleResponses(res, 201, serializeCategorizationRule(rule))
})

export const getCategorizationRules = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const rules = await CategorizationRule.find({ userId }).sort({ priority: -1, createdAt: 1 })

    handleResponses(res, 200, rules.map(serializeCategorizationRule))
})

export const getCategorizationRuleById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { ruleId } = req.params

    validateRequiredFields({ ruleId }, ['ruleId'])

    const rule = await validateUserRule(ruleId, userId)

    handleResponses(res, 200, serializeCategorizationRule(rule))
})

export const updateCategorizationRule = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { ruleId } = req.params

    validateRequiredFields({ ruleId }, ['ruleId'])

    const rule = await validateUserRule(ruleId, userId)

    const nextMatchType =
        req.body.matchType !== undefined ? parseMatchType(req.body.matchType) : rule.matchType

    if (req.body.name !== undefined) {
        const name = String(req.body.name).trim()
        if (!name) {
            throw new CustomError('Rule name is required', 400)
        }
        rule.name = name
    }

    const criteria = {
        matchValue:
            req.body.matchValue !== undefined ? String(req.body.matchValue) : rule.matchValue,
        amountMin:
            req.body.amountMin !== undefined
                ? parseOptionalAmountBound(req.body.amountMin, 'amountMin')
                : rule.amountMin,
        amountMax:
            req.body.amountMax !== undefined
                ? parseOptionalAmountBound(req.body.amountMax, 'amountMax')
                : rule.amountMax,
        accountId:
            req.body.accountId !== undefined
                ? String(req.body.accountId)
                : rule.accountId?.toString(),
        categoryId:
            req.body.categoryId !== undefined
                ? String(req.body.categoryId)
                : rule.categoryId.toString(),
        tags: req.body.tags !== undefined ? parseRuleTags(req.body.tags) : rule.tags,
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
        nextMatchType === 'account_id' && criteria.accountId
            ? new Types.ObjectId(criteria.accountId)
            : undefined
    rule.categoryId = criteria.categoryId as unknown as ICategorizationRule['categoryId']
    rule.tags = criteria.tags

    if (req.body.priority !== undefined) {
        rule.priority = parsePriority(req.body.priority)
    }
    if (req.body.isActive !== undefined) {
        rule.isActive = Boolean(req.body.isActive)
    }

    const updatedRule = await rule.save()

    handleResponses(res, 200, serializeCategorizationRule(updatedRule))
})

export const deleteCategorizationRule = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { ruleId } = req.params

    validateRequiredFields({ ruleId }, ['ruleId'])

    const rule = await validateUserRule(ruleId, userId)
    rule.deletedAt = new Date()
    await rule.save()

    handleResponses(res, 200, { message: 'Categorization rule deleted successfully' })
})

export const bulkApplyRules = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const result = await bulkApplyCategorizationRules(userId)

    handleResponses(res, 200, {
        message: `Applied rules to ${result.updated} transaction${result.updated === 1 ? '' : 's'}`,
        ...result,
    })
})

export const testCategorizationRule = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    validateRequiredFields(req.body, ['amount', 'accountId'])

    const amountMinor = parseClientAmount(req.body.amount)
    const title = req.body.title !== undefined ? String(req.body.title).trim() : ''
    const description =
        req.body.description !== undefined ? String(req.body.description).trim() : undefined
    const type = req.body.type !== undefined ? String(req.body.type) : 'expense'

    const result = await applyCategorizationRules(userId, {
        title,
        description,
        amount: amountMinor,
        accountId: String(req.body.accountId),
        type,
    })

    if (!result) {
        handleResponses(res, 200, {
            matched: false,
            message: 'No active rule matched the sample transaction',
        })
        return
    }

    handleResponses(res, 200, {
        matched: true,
        ruleId: result.ruleId.toString(),
        ruleName: result.ruleName,
        categoryId: result.categoryId.toString(),
        tags: result.tags,
    })
})
