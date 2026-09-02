import { Model, Types } from 'mongoose'
import { CustomError } from '../errors/customError'
import { ERROR_MESSAGES } from '../errors/errorMessages'

export const validateOwnership = async <T extends { userId: Types.ObjectId }>(
    model: Model<T>,
    id: string,
    userId: string,
    notFoundMessage: string
): Promise<T> => {
    // SEC-60: a malformed id would otherwise CastError → 500. A non-ObjectId can't name a
    // resource the caller owns, so collapse it into the not-found response like a real miss.
    if (!Types.ObjectId.isValid(id)) {
        throw new CustomError(notFoundMessage, 404)
    }
    const resource = await model.findById(id)
    if (!resource) {
        throw new CustomError(notFoundMessage, 404)
    }
    if (resource.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }
    return resource
}
