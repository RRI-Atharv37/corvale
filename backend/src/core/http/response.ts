import { Response } from 'express'

export const handleResponses = (res: Response, statusCode: number, data: unknown): void => {
    res.status(statusCode).json({
        success: true,
        data,
    })
}
