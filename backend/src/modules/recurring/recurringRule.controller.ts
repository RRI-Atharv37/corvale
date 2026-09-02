import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import RecurringRule, { IRecurringRule } from './recurringRule.model'
import { ITransaction, Transaction } from '@modules/transactions'
import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { parseSupportedCurrency } from '@core/money/currencyUtils'
import {
    confirmRecurringDraft,
    dismissRecurringDraft,
    generateDraftsForRule,
    generateDraftsForUser,
    parseCustomIntervalDays,
    parseInterval,
    parseNextDueDate,
    parseRecurringAmount,
    parseTransactionType,
    serializeRecurringRule,
    serializeRecurringRules,
    validateRuleReferences,
} from './recurringRuleUtils'
import { endOfDayInTimezone } from '@core/time/timezoneUtils'
import { DEFAULT_TIMEZONE } from '@core/time/timezoneUtils'
import { buildScopedListFilter, parseOptionalWorkspaceId } from '@core/access/workspace'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { validateRequiredFields } from '@core/http/validation'
import { serializeTransactions } from "@modules/transactions/transactionUtils";
import { assertWorkspaceMembership, validateResourceAccess } from "@modules/workspaces/access";

const getUserTimezone = (req: AuthRequest): string => {
    return req.user?.timezone?.trim() || DEFAULT_TIMEZONE
}

const getEndOfToday = (timezone: string): Date => {
    const today = new Date().toISOString().slice(0, 10)
    return endOfDayInTimezone(today, timezone)
}

const resolveListWorkspaceId = async (req: AuthRequest): Promise<string | null> => {
    const userId = getUserId(req)
    const workspaceId = parseOptionalWorkspaceId(req.query.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'viewer')
    }

    return workspaceId
}

export const createRecurringRule = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)

    validateRequiredFields(req.body, [
        'title',
        'type',
        'amount',
        'accountId',
        'categoryId',
        'interval',
        'nextDueDate',
    ])

    const type = parseTransactionType(req.body.type)
    const amount = parseRecurringAmount(req.body.amount)
    const interval = parseInterval(req.body.interval)
    const customIntervalDays = parseCustomIntervalDays(interval, req.body.customIntervalDays)
    const nextDueDate = parseNextDueDate(req.body.nextDueDate, timezone)
    const workspaceId = parseOptionalWorkspaceId(req.body.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'editor')
    }

    const { account } = await validateRuleReferences(
        userId,
        req.body.accountId,
        req.body.categoryId,
        workspaceId
    )

    const currency =
        req.body.currency !== undefined && req.body.currency !== null && req.body.currency !== ''
            ? parseSupportedCurrency(req.body.currency)
            : account.currency

    const rule = await RecurringRule.create({
        userId,
        workspaceId,
        title: String(req.body.title).trim(),
        type,
        amount,
        currency,
        accountId: req.body.accountId,
        categoryId: req.body.categoryId,
        interval,
        customIntervalDays,
        nextDueDate,
        description: typeof req.body.description === 'string' ? req.body.description.trim() : undefined,
        paymentMethod:
            typeof req.body.paymentMethod === 'string' ? req.body.paymentMethod.trim() : undefined,
        tags: Array.isArray(req.body.tags) ? req.body.tags.map(String) : undefined,
        isActive: req.body.isActive !== false,
    })

    handleResponses(res, 201, serializeRecurringRule(rule))
})

export const getRecurringRules = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const includeArchived = req.query.includeArchived === 'true'
    const workspaceId = await resolveListWorkspaceId(req)

    const filter: Record<string, unknown> = buildScopedListFilter(userId, workspaceId)
    if (!includeArchived) {
        filter.isArchived = false
    }

    if (req.query.isActive === 'true') {
        filter.isActive = true
    } else if (req.query.isActive === 'false') {
        filter.isActive = false
    }

    const rules = await RecurringRule.find(filter).sort({ nextDueDate: 1, createdAt: -1 })
    handleResponses(res, 200, serializeRecurringRules(rules))
})

export const getRecurringRuleById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { ruleId } = req.params

    validateRequiredFields({ ruleId }, ['ruleId'])

    const rule = await validateResourceAccess<IRecurringRule>(
        RecurringRule,
        ruleId,
        userId,
        ERROR_MESSAGES.RECURRING.RULE_NOT_FOUND,
        'viewer'
    )

    handleResponses(res, 200, serializeRecurringRule(rule))
})

export const updateRecurringRule = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { ruleId } = req.params

    validateRequiredFields({ ruleId }, ['ruleId'])

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

    if (req.body.title !== undefined) {
        rule.title = String(req.body.title).trim()
    }

    if (req.body.type !== undefined) {
        rule.type = parseTransactionType(req.body.type)
    }

    if (req.body.amount !== undefined) {
        rule.amount = parseRecurringAmount(req.body.amount)
    }

    if (req.body.currency !== undefined) {
        rule.currency = parseSupportedCurrency(req.body.currency)
    }

    if (req.body.accountId !== undefined || req.body.categoryId !== undefined) {
        const accountId = req.body.accountId ?? rule.accountId.toString()
        const categoryId = req.body.categoryId ?? rule.categoryId.toString()
        await validateRuleReferences(
            userId,
            accountId,
            categoryId,
            rule.workspaceId?.toString() ?? null
        )
        if (req.body.accountId !== undefined) {
            rule.accountId = new Types.ObjectId(accountId)
        }
        if (req.body.categoryId !== undefined) {
            rule.categoryId = new Types.ObjectId(categoryId)
        }
    }

    if (req.body.interval !== undefined) {
        rule.interval = parseInterval(req.body.interval)
    }

    if (req.body.customIntervalDays !== undefined || req.body.interval !== undefined) {
        rule.customIntervalDays = parseCustomIntervalDays(
            rule.interval,
            req.body.customIntervalDays ?? rule.customIntervalDays
        )
    }

    if (req.body.nextDueDate !== undefined) {
        rule.nextDueDate = parseNextDueDate(req.body.nextDueDate, timezone)
    }

    if (req.body.description !== undefined) {
        rule.description =
            typeof req.body.description === 'string' ? req.body.description.trim() : undefined
    }

    if (req.body.paymentMethod !== undefined) {
        rule.paymentMethod =
            typeof req.body.paymentMethod === 'string' ? req.body.paymentMethod.trim() : undefined
    }

    if (req.body.tags !== undefined) {
        rule.tags = Array.isArray(req.body.tags) ? req.body.tags.map(String) : undefined
    }

    if (req.body.isActive !== undefined) {
        rule.isActive = req.body.isActive === true
    }

    if (req.body.isCancelled !== undefined) {
        rule.isCancelled = req.body.isCancelled === true
    }

    const updated = await rule.save()
    handleResponses(res, 200, serializeRecurringRule(updated))
})

export const archiveRecurringRule = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { ruleId } = req.params

    validateRequiredFields({ ruleId }, ['ruleId'])

    const rule = await validateResourceAccess<IRecurringRule>(
        RecurringRule,
        ruleId,
        userId,
        ERROR_MESSAGES.RECURRING.RULE_NOT_FOUND,
        'editor'
    )

    if (rule.isArchived) {
        throw new CustomError(ERROR_MESSAGES.RECURRING.RULE_ALREADY_ARCHIVED, 400)
    }

    rule.isArchived = true
    rule.isActive = false
    await rule.save()

    handleResponses(res, 200, { message: 'Recurring rule archived successfully', data: rule })
})

export const generateRecurringDrafts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const endOfToday = getEndOfToday(timezone)
    const workspaceId = await resolveListWorkspaceId(req)

    const drafts = await generateDraftsForUser(userId, endOfToday, workspaceId, timezone)
    handleResponses(res, 200, drafts)
})

export const generateRecurringDraftsForRule = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { ruleId } = req.params
    const endOfToday = getEndOfToday(timezone)

    validateRequiredFields({ ruleId }, ['ruleId'])

    const rule = await validateResourceAccess<IRecurringRule>(
        RecurringRule,
        ruleId,
        userId,
        ERROR_MESSAGES.RECURRING.RULE_NOT_FOUND,
        'editor'
    )

    const drafts = await generateDraftsForRule(rule, userId, endOfToday, timezone)
    handleResponses(res, 200, drafts)
})

export const getRecurringDrafts = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const workspaceId = await resolveListWorkspaceId(req)

    const filter: Record<string, unknown> = {
        ...buildScopedListFilter(userId, workspaceId),
        status: 'draft',
        recurringPaymentId: { $ne: null },
        splitTransactionId: null,
    }

    if (req.query.ruleId) {
        filter.recurringPaymentId = new Types.ObjectId(String(req.query.ruleId))
    }

    const drafts = await Transaction.find(filter).sort({ date: 1, createdAt: 1 })
    handleResponses(res, 200, serializeTransactions(drafts))
})

export const confirmDraft = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { transactionId } = req.params

    validateRequiredFields({ transactionId }, ['transactionId'])

    const transaction = await validateResourceAccess<ITransaction>(
        Transaction,
        transactionId,
        userId,
        ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
        'editor'
    )

    const posted = await confirmRecurringDraft(transaction, userId)
    handleResponses(res, 200, posted)
})

export const dismissDraft = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { transactionId } = req.params

    validateRequiredFields({ transactionId }, ['transactionId'])

    const transaction = await validateResourceAccess<ITransaction>(
        Transaction,
        transactionId,
        userId,
        ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
        'editor'
    )

    await dismissRecurringDraft(transaction)
    handleResponses(res, 200, { message: 'Draft dismissed successfully' })
})
