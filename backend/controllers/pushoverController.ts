import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { getUserId, handleResponses } from '../utils/saverpushoverUtils'
import { computeUserBalances, roundMoney } from '../utils/balanceUtils'
import Saver from '../models/Saver'
import Pushover from '../models/Pushover'
import { AuthRequest } from '../middleware/authTypes'

export const pushoverToNextMonth = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const saver = await Saver.findOne({ userId })

    const pushoverAmount = roundMoney(saver?.saverAmount ?? 0)

    if (!saver || pushoverAmount <= 0) {
        throw new CustomError(ERROR_MESSAGES.PUSHOVER.ZERO_BALANCE, 400)
    }

    const pushover = new Pushover({
        userId,
        pushoverAmount,
        pushoverDate: new Date(),
    })

    await pushover.save()

    saver.pushoverAmount = roundMoney((saver.pushoverAmount ?? 0) + pushoverAmount)
    saver.saverAmount = 0
    saver.saverDate = new Date()
    await saver.save()

    const balances = await computeUserBalances(userId)

    handleResponses(res, 200, {
        message: 'Pushover to next month successful',
        data: {
            pushoverAmount,
            pushoverBaseline: saver.pushoverAmount,
            ...balances,
            remainingBalance: balances.spendableBalance,
        },
    })
})

export const getPushoverHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const pushovers = await Pushover.find({ userId }).sort({ pushoverDate: -1 })

    handleResponses(res, 200, pushovers)
})
