import { Response } from 'express'
import { Model, Types } from 'mongoose'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'

export const getUserId = (req: AuthRequest): string => {
    if (!req.user?._id) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 401)
    }
    return req.user._id.toString()
}

export const handleResponses = (res: Response, statusCode: number, data: unknown): void => {
    res.status(statusCode).json({
        success: true,
        data,
    })
}

export const validateOwnership = async <T extends { userId: Types.ObjectId }>(
    model: Model<T>,
    id: string,
    userId: string,
    notFoundMessage: string
): Promise<T> => {
    const resource = await model.findById(id)
    if (!resource) {
        throw new CustomError(notFoundMessage, 404)
    }
    if (resource.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }
    return resource
}

export const validateRequiredFields = (
    fields: Record<string, unknown>,
    requiredFields: string[]
): void => {
    const missingFields = requiredFields.filter((field) => {
        const value = fields[field]
        return value === undefined || value === null || value === ''
    })
    if (missingFields.length > 0) {
        throw new CustomError(`Missing required fields: ${missingFields.join(', ')}`, 400)
    }
}

/** Escape special regex characters to prevent ReDoS from user-supplied patterns. */
export const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build a case-insensitive MongoDB regex from sanitized user input. */
export const buildSearchRegex = (keyword: string): RegExp => {
    const trimmed = keyword.trim().slice(0, 100)
    return new RegExp(escapeRegex(trimmed), 'i')
}

export const toObjectId = (userId: string): Types.ObjectId => {
    return new Types.ObjectId(userId)
}

/**
 * Validates an optional client-supplied `_id` (Sprint 13.2: offline-created
 * records must be creatable/referenceable under a client-generated ObjectId
 * before the server has ever seen them). Returns undefined when omitted so
 * callers fall back to Mongoose's default auto-generated id.
 */
export const resolveClientObjectId = (value: unknown): Types.ObjectId | undefined => {
    if (value === undefined) {
        return undefined
    }
    if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
        throw new CustomError('Invalid _id: must be a 24-character hex ObjectId', 400)
    }
    return new Types.ObjectId(value)
}

/** Mongo's duplicate-key error (E11000) — thrown when a client _id collides with an existing document. */
export const isDuplicateKeyError = (error: unknown): boolean =>
    typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000

export const aggregateByField = async <T extends { userId: Types.ObjectId }>(
    model: Model<T>,
    userId: string,
    groupBy: string
) => {
    return model.aggregate([
        { $match: { userId: toObjectId(userId) } },
        {
            $group: {
                _id: `$${groupBy}`,
                totalAmount: { $sum: '$amount' },
            },
        },
        { $sort: { totalAmount: -1 } },
    ])
}
