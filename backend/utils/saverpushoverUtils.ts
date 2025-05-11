import { Request, Response } from 'express'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'

interface AuthRequest extends Request {
    user?: { id: string }
}

export const getUserId = (req: AuthRequest): string => {
    const userId = req.user?.id
    if (!userId) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }
    return userId
}

export const handleReponses = (res: Response, statusCode: number, data: any) => {
    res.status(statusCode).json({
        success: true,
        data: data,
    })
}

export const validateOwnership = async (model: any, id: string, userId: string) => {
    const resource = await model.findById(id)
    if (!resource) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND, 404)
    }
    if (resource.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }
    return resource
}

export const validateRequiredFields = (fields: Record<string, any>, requiredFields: string[]) => {
    const missingFields = requiredFields.filter(field => !fields[field])
    if (missingFields.length > 0) {
        throw new CustomError(`Missing required fields: ${missingFields.join(', ')}`, 400)
    }
}