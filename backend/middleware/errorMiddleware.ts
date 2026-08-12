import { Request, Response, NextFunction } from 'express'
import { CustomError } from '../utils/customError'

export const errorHandler = (
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction
): void => {
    const isCustomError = err instanceof CustomError
    const statusCode = isCustomError ? err.statusCode : 500
    const message = isCustomError ? err.message : 'Internal Server Error'

    console.error(`[${new Date().toISOString()}] ${statusCode} - ${message}`)
    if (!isCustomError) {
        console.error(err)
    }

    res.status(statusCode).json({
        success: false,
        statusCode,
        message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    })
}
