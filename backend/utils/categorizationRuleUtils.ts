import { Types } from 'mongoose'

import CategorizationRule, {
    CATEGORIZATION_MATCH_TYPES,
    CategorizationMatchType,
    ICategorizationRule,
} from '../models/CategorizationRule'
import Transaction from '../models/Transaction'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'
import { normalizeTagName } from './tagUtils'
import { fromMinorUnits } from './moneyUtils'
import { LISTABLE_TRANSACTION_FILTER, validateCategoryForTransaction } from './transactionUtils'
import { parseClientAmount, validateAccountForTransaction } from './transactionUtils'
import { matchCategorizationRule, RuleLike } from '../../shared/src/categorization'

export interface TransactionMatchInput {
    title: string
    description?: string
    amount: number
    accountId: string | Types.ObjectId
    type: string
}

export interface RuleApplyResult {
    categoryId: Types.ObjectId
    tags: string[]
    ruleId: Types.ObjectId
    ruleName: string
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const parseMatchType = (value: unknown): CategorizationMatchType => {
    const matchType = String(value ?? '').trim()
    if (!CATEGORIZATION_MATCH_TYPES.includes(matchType as CategorizationMatchType)) {
        throw new CustomError(ERROR_MESSAGES.CATEGORIZATION_RULE.INVALID_MATCH_TYPE, 400)
    }
    return matchType as CategorizationMatchType
}

export const parseRuleTags = (tags: unknown): string[] | undefined => {
    if (tags === undefined || tags === null) {
        return undefined
    }
    if (!Array.isArray(tags)) {
        throw new CustomError('Rule tags must be an array', 400)
    }
    const normalized = [
        ...new Set(tags.map((tag) => normalizeTagName(String(tag))).filter(Boolean)),
    ]
    return normalized.length > 0 ? normalized : undefined
}

export const parsePriority = (value: unknown): number => {
    if (value === undefined || value === null || value === '') {
        return 0
    }
    const priority = Number(value)
    if (!Number.isFinite(priority)) {
        throw new CustomError('Priority must be a number', 400)
    }
    return Math.trunc(priority)
}

export const parseOptionalAmountBound = (
    value: unknown,
    fieldName: string
): number | undefined => {
    if (value === undefined || value === null || value === '') {
        return undefined
    }
    try {
        return parseClientAmount(value)
    } catch {
        throw new CustomError(`${fieldName} must be a valid amount`, 400)
    }
}

export const validateRuleCriteria = async (
    userId: string,
    matchType: CategorizationMatchType,
    criteria: {
        matchValue?: string
        amountMin?: number
        amountMax?: number
        accountId?: string
        categoryId: string
        tags?: string[]
    }
): Promise<void> => {
    await validateCategoryForTransaction(criteria.categoryId, userId)

    switch (matchType) {
        case 'description_contains':
        case 'description_equals': {
            const matchValue = criteria.matchValue?.trim()
            if (!matchValue) {
                throw new CustomError(ERROR_MESSAGES.CATEGORIZATION_RULE.MATCH_VALUE_REQUIRED, 400)
            }
            if (matchValue.length > 200) {
                throw new CustomError('Match value must be 200 characters or fewer', 400)
            }
            break
        }
        case 'amount_range': {
            if (criteria.amountMin === undefined && criteria.amountMax === undefined) {
                throw new CustomError(ERROR_MESSAGES.CATEGORIZATION_RULE.AMOUNT_RANGE_REQUIRED, 400)
            }
            if (
                criteria.amountMin !== undefined &&
                criteria.amountMax !== undefined &&
                criteria.amountMin > criteria.amountMax
            ) {
                throw new CustomError(ERROR_MESSAGES.CATEGORIZATION_RULE.INVALID_AMOUNT_RANGE, 400)
            }
            break
        }
        case 'account_id': {
            if (!criteria.accountId) {
                throw new CustomError(ERROR_MESSAGES.CATEGORIZATION_RULE.ACCOUNT_REQUIRED, 400)
            }
            await validateAccountForTransaction(criteria.accountId, userId)
            break
        }
        default:
            throw new CustomError(ERROR_MESSAGES.CATEGORIZATION_RULE.INVALID_MATCH_TYPE, 400)
    }
}

export const ruleMatchesTransaction = (
    rule: ICategorizationRule,
    input: TransactionMatchInput
): boolean => {
    const ruleLike: RuleLike = {
        isActive: rule.isActive,
        matchType: rule.matchType,
        matchValue: rule.matchValue,
        amountMin: rule.amountMin,
        amountMax: rule.amountMax,
        accountId: rule.accountId?.toString(),
    }

    return matchCategorizationRule(ruleLike, { ...input, accountId: String(input.accountId) })
}

export const mergeTags = (
    existing: string[] | undefined,
    ruleTags: string[] | undefined
): string[] | undefined => {
    if (!ruleTags || ruleTags.length === 0) {
        return existing
    }
    const merged = [...new Set([...(existing ?? []), ...ruleTags])]
    return merged.length > 0 ? merged : undefined
}

export const findMatchingRule = async (
    userId: string,
    input: TransactionMatchInput
): Promise<ICategorizationRule | null> => {
    const rules = await CategorizationRule.find({ userId, isActive: true }).sort({
        priority: -1,
        createdAt: 1,
    })

    for (const rule of rules) {
        if (ruleMatchesTransaction(rule, input)) {
            return rule
        }
    }

    return null
}

export const applyCategorizationRules = async (
    userId: string,
    input: TransactionMatchInput
): Promise<RuleApplyResult | null> => {
    const rule = await findMatchingRule(userId, input)
    if (!rule) {
        return null
    }

    return {
        categoryId: rule.categoryId,
        tags: rule.tags ?? [],
        ruleId: rule._id,
        ruleName: rule.name,
    }
}

export const bulkApplyCategorizationRules = async (
    userId: string
): Promise<{ updated: number; skipped: number }> => {
    const userObjectId = new Types.ObjectId(userId)
    const rules = await CategorizationRule.find({ userId: userObjectId, isActive: true }).sort({
        priority: -1,
        createdAt: 1,
    })

    if (rules.length === 0) {
        return { updated: 0, skipped: 0 }
    }

    const transactions = await Transaction.find({
        userId: userObjectId,
        type: { $ne: 'transfer' },
        ...LISTABLE_TRANSACTION_FILTER,
    }).select('_id title description amount accountId type tags categoryId')

    let updated = 0
    let skipped = 0

    for (const transaction of transactions) {
        const matchInput: TransactionMatchInput = {
            title: transaction.title,
            description: transaction.description,
            amount: transaction.amount,
            accountId: transaction.accountId,
            type: transaction.type,
        }

        const matchedRule = rules.find((rule) => ruleMatchesTransaction(rule, matchInput))
        if (!matchedRule) {
            skipped += 1
            continue
        }

        const nextTags = mergeTags(transaction.tags, matchedRule.tags)
        const categoryChanged =
            transaction.categoryId.toString() !== matchedRule.categoryId.toString()
        const tagsChanged = JSON.stringify(transaction.tags ?? []) !== JSON.stringify(nextTags ?? [])

        if (!categoryChanged && !tagsChanged) {
            skipped += 1
            continue
        }

        transaction.categoryId = matchedRule.categoryId
        transaction.tags = nextTags
        await transaction.save()
        updated += 1
    }

    return { updated, skipped }
}

export const serializeCategorizationRule = (rule: ICategorizationRule) => ({
    _id: rule._id.toString(),
    userId: rule.userId.toString(),
    name: rule.name,
    matchType: rule.matchType,
    matchValue: rule.matchValue,
    amountMin: rule.amountMin !== undefined ? fromMinorUnits(rule.amountMin) : undefined,
    amountMax: rule.amountMax !== undefined ? fromMinorUnits(rule.amountMax) : undefined,
    accountId: rule.accountId?.toString(),
    categoryId: rule.categoryId.toString(),
    tags: rule.tags ?? [],
    priority: rule.priority,
    isActive: rule.isActive,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
})

export const formatMatchTypeLabel = (matchType: CategorizationMatchType): string => {
    switch (matchType) {
        case 'description_contains':
            return 'Description contains'
        case 'description_equals':
            return 'Description equals'
        case 'amount_range':
            return 'Amount range'
        case 'account_id':
            return 'Account'
        default:
            return matchType
    }
}

export const buildMatchSummary = (rule: ICategorizationRule): string => {
    switch (rule.matchType) {
        case 'description_contains':
            return `Contains "${rule.matchValue ?? ''}"`
        case 'description_equals':
            return `Equals "${rule.matchValue ?? ''}"`
        case 'amount_range': {
            const min =
                rule.amountMin !== undefined ? fromMinorUnits(rule.amountMin) : undefined
            const max =
                rule.amountMax !== undefined ? fromMinorUnits(rule.amountMax) : undefined
            if (min !== undefined && max !== undefined) {
                return `Amount ${min}–${max}`
            }
            if (min !== undefined) {
                return `Amount ≥ ${min}`
            }
            if (max !== undefined) {
                return `Amount ≤ ${max}`
            }
            return 'Amount range'
        }
        case 'account_id':
            return 'Specific account'
        default:
            return rule.matchType
    }
}
