import dotenv from 'dotenv'
dotenv.config()

import jwt from 'jsonwebtoken'
import { Request, Response, NextFunction } from 'express'

import User, {IUser} from '../models/User'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'

export interface AuthRequest extends Request {
    user?: IUser
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(new CustomError(ERROR_MESSAGES.AUTH.TOKEN_MISSING, 401)) 
    }

    const token = authHeader.split(' ')[1]

    try {
        if (!process.env.JWT_SECRET) {
            return next(new CustomError(ERROR_MESSAGES.GENERAL.JWT_SECRET_MISSING, 500))
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string }

        const user = await User.findById(decoded.id).select('-password')
        if(!user) {
            return next(new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 401))
        }

        req.user = user
        return next()
    } catch (error) {
        next(new CustomError(ERROR_MESSAGES.AUTH.TOKEN_MISSING, 401))
    }
}