import { Response } from 'express'

export const handleResponses = (res: Response, statusCode: number, data: any) => {
    res.status(statusCode).json({
        success: true,
        data: data,
    })
}

export default handleResponses
