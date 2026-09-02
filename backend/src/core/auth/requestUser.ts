import { Types } from 'mongoose'

import { CustomError } from '../errors/customError'
import { ERROR_MESSAGES } from '../errors/errorMessages'

/** Structural — any request carrying an authenticated `user` (see `@http/middleware/authTypes`). */
interface RequestWithUser {
    user?: { _id?: Types.ObjectId }
}

export const getUserId = (req: RequestWithUser): string => {
    if (!req.user?._id) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 401)
    }
    return req.user._id.toString()
}
