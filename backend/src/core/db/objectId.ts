import { Types } from 'mongoose'
import { CustomError } from '../errors/customError'

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
