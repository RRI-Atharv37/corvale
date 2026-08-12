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
