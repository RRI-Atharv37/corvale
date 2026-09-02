import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { User } from '@modules/users'
import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { normalizePairKey, parsePositiveRate } from './exchangeRateUtils'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { validateRequiredFields } from '@core/http/validation'

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
