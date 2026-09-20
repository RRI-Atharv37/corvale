import type { Request, Response } from 'express'
import asyncHandler from 'express-async-handler'

import { handleBillingWebhook } from './webhook.service'

export const receiveBillingWebhook = asyncHandler(async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)

    const data = await handleBillingWebhook(rawBody, req.headers)

    res.status(200).json({ success: true, data })
})
