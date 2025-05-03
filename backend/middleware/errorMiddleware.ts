import { Request, Response, NextFunction } from 'express'
import { CustomError } from '../utils/customError'

export const errorHandler = (err: CustomError, req: Request, res: Response, next: NextFunction) => {
    const statusCode = err.statusCode || 500
    const message = err.message || 'Internal Server Error'

    console.error(`[${new Date().toISOString()}] ${statusCode} - ${message}`)

    res.status(statusCode).json({
        success: false,
        statusCode,
        message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    })
}