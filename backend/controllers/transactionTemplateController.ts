import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import TransactionTemplate, { ITransactionTemplate } from '../models/TransactionTemplate'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { evaluateBudgetOverLimitNotifications } from '../utils/notificationUtils'
import {
    parseTemplateAmount,
    parseTemplateTags,
    parseTemplateType,
    serializeTransactionTemplate,
    validateTemplateReferences,
} from '../utils/transactionTemplateUtils'
import {
    applyTransactionToAccount,
    getUserId,
    handleResponses,
    serializeTransactionWithSplits,
    Transaction,
    validateAccountForTransaction,
    validateRequiredFields,
} from '../utils/transactionUtils'
import { isDuplicateKeyError, resolveClientObjectId } from '../utils/sharedUtils'
import {
    assertAccountMatchesWorkspace,
    assertWorkspaceMembership,
    parseOptionalWorkspaceId,
} from '../utils/workspaceUtils'

const validateUserTemplate = async (
    templateId: string,
    userId: string
): Promise<ITransactionTemplate> => {
    const template = await TransactionTemplate.findById(templateId)
    if (!template) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION_TEMPLATE.TEMPLATE_NOT_FOUND, 404)
    }

    if (template.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    return template
}

export const createTransactionTemplate = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    validateRequiredFields(req.body, ['name', 'type', 'amount', 'accountId', 'categoryId'])

    const name = String(req.body.name).trim()
    if (!name) {
        throw new CustomError('Template name is required', 400)
    }

    const type = parseTemplateType(req.body.type)
    const amount = parseTemplateAmount(req.body.amount)
    const accountId = String(req.body.accountId)
    const categoryId = String(req.body.categoryId)

    await validateTemplateReferences(userId, accountId, categoryId)
    const clientId = resolveClientObjectId(req.body._id)

    let template
    try {
        template = await TransactionTemplate.create({
            ...(clientId ? { _id: clientId } : {}),
            userId,
            name,
            type,
            amount,
            accountId,
            categoryId,
            tags: parseTemplateTags(req.body.tags),
            description: req.body.description?.trim() || undefined,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('A transaction template with this id already exists', 400)
        }
        throw error
    }

    handleResponses(res, 201, serializeTransactionTemplate(template))
})

export const getTransactionTemplates = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const templates = await TransactionTemplate.find({ userId }).sort({ name: 1, createdAt: 1 })

    handleResponses(res, 200, templates.map(serializeTransactionTemplate))
})

export const getTransactionTemplateById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { templateId } = req.params

    validateRequiredFields({ templateId }, ['templateId'])

    const template = await validateUserTemplate(templateId, userId)

    handleResponses(res, 200, serializeTransactionTemplate(template))
})

export const updateTransactionTemplate = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { templateId } = req.params

    validateRequiredFields({ templateId }, ['templateId'])

    const template = await validateUserTemplate(templateId, userId)

    if (req.body.name !== undefined) {
        const name = String(req.body.name).trim()
        if (!name) {
            throw new CustomError('Template name is required', 400)
        }
        template.name = name
    }

    if (req.body.type !== undefined) {
        template.type = parseTemplateType(req.body.type)
    }

    if (req.body.amount !== undefined) {
        template.amount = parseTemplateAmount(req.body.amount)
    }

    const nextAccountId =
        req.body.accountId !== undefined
            ? String(req.body.accountId)
            : template.accountId.toString()
    const nextCategoryId =
        req.body.categoryId !== undefined
            ? String(req.body.categoryId)
            : template.categoryId.toString()

    await validateTemplateReferences(userId, nextAccountId, nextCategoryId)

    if (req.body.accountId !== undefined) {
        template.accountId = new Types.ObjectId(nextAccountId)
    }

    if (req.body.categoryId !== undefined) {
        template.categoryId = new Types.ObjectId(nextCategoryId)
    }

    if (req.body.tags !== undefined) {
        template.tags = parseTemplateTags(req.body.tags)
    }

    if (req.body.description !== undefined) {
        template.description = req.body.description?.trim() || undefined
    }

    const updatedTemplate = await template.save()

    handleResponses(res, 200, serializeTransactionTemplate(updatedTemplate))
})

export const deleteTransactionTemplate = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { templateId } = req.params

    validateRequiredFields({ templateId }, ['templateId'])

    const template = await validateUserTemplate(templateId, userId)
    template.deletedAt = new Date()
    await template.save()

    handleResponses(res, 200, { message: 'Transaction template deleted successfully' })
})

export const applyTransactionTemplate = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { templateId } = req.params
    const { date, workspaceId } = req.body ?? {}

    validateRequiredFields({ templateId }, ['templateId'])

    const template = await validateUserTemplate(templateId, userId)
    const resolvedWorkspaceId = parseOptionalWorkspaceId(workspaceId) ?? null

    if (resolvedWorkspaceId) {
        await assertWorkspaceMembership(resolvedWorkspaceId, userId, 'editor')
    }

    const account = await validateAccountForTransaction(template.accountId.toString(), userId)
    assertAccountMatchesWorkspace(account.workspaceId, resolvedWorkspaceId)

    const parsedDate = date !== undefined ? new Date(date) : new Date()
    if (isNaN(parsedDate.getTime())) {
        throw new CustomError('Invalid date format', 400)
    }

    const transaction = await Transaction.create({
        userId,
        workspaceId: resolvedWorkspaceId,
        accountId: template.accountId,
        categoryId: template.categoryId,
        type: template.type,
        status: 'posted',
        amount: template.amount,
        currency: account.currency,
        title: template.name,
        description: template.description,
        date: parsedDate,
        tags: template.tags,
    })

    await applyTransactionToAccount(account, transaction.type, transaction.amount)

    const payload = await serializeTransactionWithSplits(transaction, userId)
    await evaluateBudgetOverLimitNotifications(userId, transaction)

    handleResponses(res, 201, payload)
})
