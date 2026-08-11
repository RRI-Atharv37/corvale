import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { getUserId, handleResponses } from '../utils/saverpushoverUtils'
import Saver from '../models/Saver'
import Pushover from '../models/Pushover'
import { AuthRequest } from '../middleware/authTypes'

export const pushoverToNextMonth = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const saver = await Saver.findOne({ userId })

    if (!saver) {
        throw new CustomError(ERROR_MESSAGES.SAVER.SAVER_NOT_FOUND, 404)
    }

    const pushoverAmount = saver.saverAmount ?? 0

    const pushover = new Pushover({
        userId,
        pushoverAmount,
        pushoverDate: new Date(),
    })

    await pushover.save()

    saver.saverAmount = 0
    await saver.save()

    handleResponses(res, 200, {
        message: 'Pushover to next month successful',
        data: {
            pushoverAmount,
        },
    })
})
