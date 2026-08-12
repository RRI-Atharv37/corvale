import dotenv from 'dotenv'
dotenv.config()

import jwt from 'jsonwebtoken'
import { Response, NextFunction } from 'express'

import User from '../models/User'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { AuthRequest } from './authTypes'

export type { AuthRequest } from './authTypes'

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

        const decoded = jwt.verify(token, process.env.JWT_SECRET) as { id: string; tv?: number }

        const user = await User.findById(decoded.id).select('-password')
        if (!user) {
            return next(new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 401))
        }

        const tokenVersion = decoded.tv ?? 0
        if (tokenVersion !== user.tokenVersion) {
            return next(new CustomError(ERROR_MESSAGES.AUTH.TOKEN_REVOKED, 401))
        }

        req.user = user
        return next()
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return next(new CustomError(ERROR_MESSAGES.AUTH.TOKEN_EXPIRED, 401))
        }
        if (error instanceof jwt.JsonWebTokenError) {
            return next(new CustomError(ERROR_MESSAGES.AUTH.TOKEN_INVALID, 401))
        }
        return next(new CustomError(ERROR_MESSAGES.AUTH.TOKEN_INVALID, 401))
    }
}
