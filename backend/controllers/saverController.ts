import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { getUserId, handleResponses, validateRequiredFields } from '../utils/saverpushoverUtils'
import { computeUserBalances, roundMoney } from '../utils/balanceUtils'
import Saver from '../models/Saver'
import { AuthRequest } from '../middleware/authTypes'

const buildSaverResponse = async (userId: string, saverDate?: Date) => {
    const balances = await computeUserBalances(userId)
    return {
        ...balances,
        remainingBalance: balances.spendableBalance,
        saverDate,
    }
}

export const addSaver = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const { customAmount, percentage = 30, customPercentage } = req.body
    const balances = await computeUserBalances(userId)

    const effectivePercentage = customPercentage ?? percentage

    if (isNaN(Number(effectivePercentage)) || effectivePercentage < 0 || effectivePercentage > 100) {
        throw new CustomError('Invalid percentage format', 400)
    }

    const computedAmount = roundMoney((balances.spendableBalance * Number(effectivePercentage)) / 100)
    const depositAmount =
        customAmount !== undefined && customAmount !== null
            ? roundMoney(Number(customAmount))
            : computedAmount

    if (isNaN(depositAmount) || depositAmount <= 0) {
        throw new CustomError('Invalid saver amount', 400)
    }

    if (depositAmount > balances.spendableBalance) {
        throw new CustomError(ERROR_MESSAGES.SAVER.INSUFFICIENT_SPENDABLE, 400)
    }

    const saver = await Saver.findOneAndUpdate(
        { userId },
        { $inc: { saverAmount: depositAmount }, $set: { saverDate: new Date() } },
        { new: true, upsert: true }
    )

    const responseData = await buildSaverResponse(userId, saver.saverDate)

    handleResponses(res, 200, {
        message: 'Amount added to saver successfully',
        data: responseData,
    })
})

export const withdrawSaver = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    validateRequiredFields(req.body, ['amount'])

    const { amount } = req.body
    const withdrawAmount = roundMoney(Number(amount))

    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
        throw new CustomError('Invalid amount format', 400)
    }

    const saver = await Saver.findOne({ userId })

    if (!saver || roundMoney(saver.saverAmount ?? 0) < withdrawAmount) {
        throw new CustomError(ERROR_MESSAGES.SAVER.INSUFFICIENT_FUNDS, 400)
    }

    saver.saverAmount = roundMoney((saver.saverAmount ?? 0) - withdrawAmount)
    saver.saverDate = new Date()
    await saver.save()

    const responseData = await buildSaverResponse(userId, saver.saverDate)

    handleResponses(res, 200, {
        message: 'Amount withdrawn from saver successfully',
        data: responseData,
    })
})

export const getSaver = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const saver = await Saver.findOne({ userId })
    const responseData = await buildSaverResponse(userId, saver?.saverDate)

    handleResponses(res, 200, {
        message: 'Saver account retrieved successfully',
        data: responseData,
    })
})
