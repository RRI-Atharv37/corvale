import { Request, Response } from 'express'
import Income from '../models/Income'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'

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

// Validate if the user is the owner of the resource
// Checks if the userId in the request matches the userId of the resource
// example: validateOwnership(Expense, expenseId, userId)
export const validateOwnership = async (model: any, id: string, userId: string) => {
    const resource = await model.findById(id)
    if (!resource) {
        throw new CustomError(ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND, 404)
    }
    if (resource.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }
    return resource
}

// Validate required fields in the request body
// Checks if the required fields are present in the request body
// example: validateRequiredFields(req.body, ['name', 'amount'])
export const validateRequiredFields = (fields: Record<string, any>, requiredFields: string[]) => {
    const missingFields = requiredFields.filter(field => !fields[field])
    if (missingFields.length > 0) {
        throw new CustomError(`Missing required fields: ${missingFields.join(', ')}`, 400)
    }
}

export const aggregateIncomes = async (userId: string, groupBy: string) => {
    return await Income.aggregate([
        { $match: { user: userId } },
        { $group: {
                _id: `$${groupBy}`,
                totalAmount: { $sum: '$amount' },
            } },
        { $sort: { totalAmount: -1 } }
    ])
}