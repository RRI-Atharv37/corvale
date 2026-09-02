import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { handleResponses } from '@core/http/response'
import { parseSupportedCurrency } from '@core/money/currencyUtils'
import { isValidTimezone } from '@core/time/timezoneUtils'
import User, { type IUser } from './user.model'
import { parseDateFormat, parsePageSize } from './userPreferencesUtils'
import { assertAccountDeletionAllowed, computeAccountDeletionImpact, deleteUserAccountCascade } from './accountDeletionUtils'
import { syncUserCurrencyData } from './currencySync'
import { buildLegalAcceptance, toPublicUser } from './userSerialization'
import { clearRefreshTokenCookie } from "@infra/config/refreshCookie";
import { parseNotificationPreferences } from "@modules/notifications/notificationUtils";

export const getUserInfo = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id

    const user = (await User.findById(userId)) as IUser | null

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    handleResponses(res, 200, toPublicUser(user))
})

/**
 * Re-accept the current Terms and Privacy Policy (M0c). Backs the `LegalGate` prompt shown when
 * either version bumps, and the one-time prompt for accounts that predate the consent record.
 *
 * There is no body: the versions are the server's to stamp, and re-accepting necessarily
 * re-affirms the 18+ attestation the user made at signup.
 */
export const acceptLegalTerms = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id

    const user = (await User.findById(userId)) as IUser | null

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    user.legalAcceptance = buildLegalAcceptance()
    await user.save()

    handleResponses(res, 200, toPublicUser(user))
})

export const updateUserPreferences = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id

    const user = (await User.findById(userId)) as IUser | null

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    const { fullName, preferredCurrency, dateFormat, pageSize, timezone, notificationPreferences } = req.body

    let preferredCurrencyChanged = false

    if (fullName !== undefined) {
        if (typeof fullName !== 'string' || !fullName.trim()) {
            throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_FULL_NAME, 400)
        }
        user.fullName = fullName.trim()
    }

    if (preferredCurrency !== undefined) {
        const nextCurrency = parseSupportedCurrency(preferredCurrency)
        preferredCurrencyChanged = nextCurrency !== user.preferredCurrency
        user.preferredCurrency = nextCurrency
    }

    if (dateFormat !== undefined) {
        user.dateFormat = parseDateFormat(dateFormat)
    }

    if (pageSize !== undefined) {
        user.pageSize = parsePageSize(pageSize)
    }

    if (timezone !== undefined) {
        if (typeof timezone !== 'string' || !timezone.trim() || !isValidTimezone(timezone.trim())) {
            throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_TIMEZONE, 400)
        }
        user.timezone = timezone.trim()
    }

    if (notificationPreferences !== undefined) {
        try {
            const parsed = parseNotificationPreferences(notificationPreferences)
            if (parsed) {
                user.notificationPreferences = {
                    ...user.notificationPreferences,
                    ...parsed,
                }
            }
        } catch (error) {
            throw new CustomError(
                error instanceof Error ? error.message : 'Invalid notification preferences',
                400
            )
        }
    }

    await user.save()

    if (preferredCurrencyChanged) {
        await syncUserCurrencyData(user._id, user.preferredCurrency)
    }

    handleResponses(res, 200, toPublicUser(user))
})

/**
 * Preview for the delete-account confirmation flow (Part 1) - lets the client show "N records in
 * M shared workspaces will stay in those workspaces but won't be linked to you anymore" before
 * the user commits to a password-confirmed, irreversible deletion. Read-only; no password check
 * needed since nothing is mutated.
 */
export const getAccountDeletionImpact = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString()
    if (!userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 401)
    }

    const impact = await computeAccountDeletionImpact(userId)
    handleResponses(res, 200, impact)
})

export const deleteUserAccount = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString()
    if (!userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 401)
    }

    const { password } = req.body
    if (!password || typeof password !== 'string') {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    // req.user comes from authenticateRequest, which loads the user with `.select('-password')` -
    // re-fetch with the password field to verify it, same as loginUser.
    const user = (await User.findById(userId)) as IUser | null
    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
        throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_CREDENTIALS, 400)
    }

    await assertAccountDeletionAllowed(userId)
    await deleteUserAccountCascade(userId)

    clearRefreshTokenCookie(res)
    handleResponses(res, 200, { message: 'Account deleted successfully' })
})
