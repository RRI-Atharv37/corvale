import { Types } from 'mongoose'

import TransactionTemplate, { ITransactionTemplate } from '../models/TransactionTemplate'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    parseTemplateAmount,
    parseTemplateTags,
    parseTemplateType,
    validateTemplateReferences,
} from '../utils/transactionTemplateUtils'
import { validateResourceAccess } from '@core/access/workspace'
import { DeleteOpOutcome, softDeleteEntityForOp } from './syncEntityHelpers'
import { fromMinorUnits } from '@shared/money'
import { isDuplicateKeyError, resolveClientObjectId } from '@core/db/objectId'
import { validateRequiredFields } from '@core/http/validation'

/**
 * `parseTemplateAmount` expects a REST body's major-unit decimal and
 * converts it to minor units itself. Sync payloads carry `amount` already in
 * minor units (the local SQLite/TransactionTemplate schema convention) —
 * mirrors the `transaction.create` conversion already in
 * `syncController.ts`'s `applyCreateOp`, applied here for the same reason.
 */
const toMajorAmount = (value: unknown): unknown => (typeof value === 'number' ? fromMinorUnits(value) : value)

/**
 * Sprint 13.9: create/update/delete logic for POST /sync/push, mirroring
 * transactionTemplateController's createTransactionTemplate/
 * updateTransactionTemplate/deleteTransactionTemplate exactly. Real
 * `deletedAt` soft-delete, so delete tombstones unconditionally.
 * applyTransactionTemplate stays REST-only (creates a transaction as a side
 * effect — not a raw field edit on the template itself).
 */

const validateUserTemplateForOp = async (
    templateId: string,
    userId: string
): Promise<ITransactionTemplate> =>
    validateResourceAccess<ITransactionTemplate>(
        TransactionTemplate,
        templateId,
        userId,
        ERROR_MESSAGES.TRANSACTION_TEMPLATE.TEMPLATE_NOT_FOUND,
        'editor'
    )

export const createTransactionTemplateForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<ITransactionTemplate> => {
    validateRequiredFields(payload, ['name', 'type', 'amount', 'accountId', 'categoryId'])

    const name = String(payload.name).trim()
    if (!name) {
        throw new CustomError('Template name is required', 400)
    }

    const type = parseTemplateType(payload.type)
    const amount = parseTemplateAmount(toMajorAmount(payload.amount))
    const accountId = String(payload.accountId)
    const categoryId = String(payload.categoryId)

    await validateTemplateReferences(userId, accountId, categoryId)
    const clientId = resolveClientObjectId(payload._id)

    try {
        return await TransactionTemplate.create({
            ...(clientId ? { _id: clientId } : {}),
            userId,
            name,
            type,
            amount,
            accountId,
            categoryId,
            tags: parseTemplateTags(payload.tags),
            description: typeof payload.description === 'string' ? payload.description.trim() || undefined : undefined,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('A transaction template with this id already exists', 400)
        }
        throw error
    }
}

export const updateTransactionTemplateForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<ITransactionTemplate> => {
    const templateId = payload._id
    if (typeof templateId !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

    const template = await validateUserTemplateForOp(templateId, userId)

    if (payload.name !== undefined) {
        const name = String(payload.name).trim()
        if (!name) {
            throw new CustomError('Template name is required', 400)
        }
        template.name = name
    }

    if (payload.type !== undefined) {
        template.type = parseTemplateType(payload.type)
    }

    if (payload.amount !== undefined) {
        template.amount = parseTemplateAmount(toMajorAmount(payload.amount))
    }

    const nextAccountId =
        payload.accountId !== undefined ? String(payload.accountId) : template.accountId.toString()
    const nextCategoryId =
        payload.categoryId !== undefined ? String(payload.categoryId) : template.categoryId.toString()

    await validateTemplateReferences(userId, nextAccountId, nextCategoryId)

    if (payload.accountId !== undefined) {
        template.accountId = new Types.ObjectId(nextAccountId)
    }

    if (payload.categoryId !== undefined) {
        template.categoryId = new Types.ObjectId(nextCategoryId)
    }

    if (payload.tags !== undefined) {
        template.tags = parseTemplateTags(payload.tags)
    }

    if (payload.description !== undefined) {
        template.description =
            typeof payload.description === 'string' ? payload.description.trim() || undefined : undefined
    }

    return template.save()
}

export const deleteTransactionTemplateForOp = (
    userId: string,
    payload: Record<string, unknown>
): Promise<DeleteOpOutcome> =>
    softDeleteEntityForOp(
        TransactionTemplate,
        userId,
        payload,
        ERROR_MESSAGES.TRANSACTION_TEMPLATE.TEMPLATE_NOT_FOUND
    )
