import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { getUserId, handleResponses, validateRequiredFields } from '../utils/saverpushoverUtils'
import Saver from '../models/Saver'
import { AuthRequest } from '../middleware/authTypes'

export const addSaver = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    validateRequiredFields(req.body, ['remainingBalance'])

    const { remainingBalance, customAmount, percentage = 30, customPercentage } = req.body

    if (isNaN(Number(remainingBalance)) || Number(remainingBalance) < 0) {
        throw new CustomError('Invalid remaining balance', 400)
    }

    const effectivePercentage = customPercentage ?? percentage

    if (isNaN(Number(effectivePercentage)) || effectivePercentage < 0 || effectivePercentage > 100) {
        throw new CustomError('Invalid percentage format', 400)
    }

    const computedAmount = (Number(remainingBalance) * Number(effectivePercentage)) / 100
    const saverAmount =
        customAmount !== undefined && customAmount !== null
            ? Number(customAmount)
            : computedAmount

    if (isNaN(saverAmount) || saverAmount < 0) {
        throw new CustomError('Invalid saver amount', 400)
    }

    if (saverAmount > Number(remainingBalance)) {
        throw new CustomError('Saver amount cannot be greater than remaining balance', 400)
    }

    const saver = await Saver.findOneAndUpdate(
        { userId },
        { $inc: { saverAmount } },
        { new: true, upsert: true }
    )

    handleResponses(res, 200, {
        message: 'Amount added to saver successfully',
        data: {
            saverAmount: saver.saverAmount,
            saverDate: saver.saverDate,
        },
    })
})

export const withdrawSaver = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    validateRequiredFields(req.body, ['amount'])

    const { amount } = req.body

    if (isNaN(Number(amount)) || Number(amount) <= 0) {
        throw new CustomError('Invalid amount format', 400)
    }

    const saver = await Saver.findOne({ userId })

    if (!saver || (saver.saverAmount ?? 0) < Number(amount)) {
        throw new CustomError(ERROR_MESSAGES.SAVER.INSUFFICIENT_FUNDS, 400)
    }

    saver.saverAmount = (saver.saverAmount ?? 0) - Number(amount)
    await saver.save()

    handleResponses(res, 200, {
        message: 'Amount withdrawn from saver successfully',
        data: {
            saverAmount: saver.saverAmount,
            saverDate: saver.saverDate,
        },
    })
})

export const getSaver = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const saver = await Saver.findOne({ userId })
    if (!saver) {
        throw new CustomError(ERROR_MESSAGES.SAVER.SAVER_NOT_FOUND, 404)
    }

    handleResponses(res, 200, {
        message: 'Saver account retrieved successfully',
        data: {
            saverAmount: saver.saverAmount,
            saverDate: saver.saverDate,
        },
    })
})
