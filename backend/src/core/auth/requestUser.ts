import { AuthRequest } from './authTypes'
import { CustomError } from '../errors/customError'
import { ERROR_MESSAGES } from '../errors/errorMessages'

export const getUserId = (req: AuthRequest): string => {
    if (!req.user?._id) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 401)
    }
    return req.user._id.toString()
}
