import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import User from '../models/User'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { normalizePairKey, parsePositiveRate } from '../utils/exchangeRateUtils'
import { getUserId, handleResponses, validateRequiredFields } from '../utils/sharedUtils'

export const getExchangeRates = asyncHandler(async (req: AuthRequest, res: Response) => {
    handleResponses(res, 200, req.user?.exchangeRates ?? {})
})

export const createExchangeRate = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    validateRequiredFields(req.body, ['pair', 'rate'])

    const key = normalizePairKey(req.body.pair)
    const rate = parsePositiveRate(req.body.rate)

    const user = await User.findById(userId)
    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    user.exchangeRates = { ...user.exchangeRates, [key]: rate }
    user.markModified('exchangeRates')
    await user.save()

    handleResponses(res, 201, user.exchangeRates)
})

export const updateExchangeRate = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const key = normalizePairKey(req.params.pair)
    validateRequiredFields(req.body, ['rate'])

    const rate = parsePositiveRate(req.body.rate)

    const user = await User.findById(userId)
    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    if (typeof user.exchangeRates?.[key] !== 'number') {
        throw new CustomError(ERROR_MESSAGES.EXCHANGE_RATE.RATE_NOT_FOUND, 404)
    }

    user.exchangeRates = { ...user.exchangeRates, [key]: rate }
    user.markModified('exchangeRates')
    await user.save()

    handleResponses(res, 200, user.exchangeRates)
})

export const deleteExchangeRate = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const key = normalizePairKey(req.params.pair)

    const user = await User.findById(userId)
    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    if (typeof user.exchangeRates?.[key] !== 'number') {
        throw new CustomError(ERROR_MESSAGES.EXCHANGE_RATE.RATE_NOT_FOUND, 404)
    }

    const nextRates = { ...user.exchangeRates }
    delete nextRates[key]
    user.exchangeRates = nextRates
    user.markModified('exchangeRates')
    await user.save()

    handleResponses(res, 200, user.exchangeRates)
})
