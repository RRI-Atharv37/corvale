import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import User, { IUser } from '../models/User'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { handleResponses } from '../utils/authUtils'
import {
    generateAccessToken,
    getRefreshTokenFromRequest,
    setRefreshTokenCookie,
    clearRefreshTokenCookie,
} from '../utils/tokenUtils'
import {
    createRefreshToken,
    revokeRefreshToken,
    revokeAllRefreshTokensForUser,
    rotateRefreshToken,
} from '../utils/refreshTokenService'
import {
    buildPasswordResetUrl,
    createPasswordResetForUser,
    logPasswordResetLink,
    resetPasswordWithToken,
} from '../utils/passwordResetUtils'
import {
    buildEmailVerificationUrl,
    createEmailVerificationForUser,
    logEmailVerificationLink,
    verifyEmailWithToken,
} from '../utils/emailVerificationUtils'
import { isSmtpConfigured, sendPasswordResetEmail, sendEmailVerificationEmail } from '../utils/mailService'
import { parseSupportedCurrency, syncUserCurrencyData } from '../utils/currencyUtils'
import { isValidTimezone } from '../utils/timezoneUtils'
import { parseNotificationPreferences } from '../utils/notificationUtils'
import { parseDateFormat, parsePageSize } from '../utils/userPreferencesUtils'
import { normalizeEmail } from '../utils/emailUtils'
import { validatePassword } from '../utils/passwordPolicy'
import { assertAccountDeletionAllowed, deleteUserAccountCascade } from '../utils/accountDeletionUtils'

const toPublicUser = (user: IUser) => ({
    _id: user._id,
    fullName: user.fullName,
    email: user.email,
    timezone: user.timezone,
    preferredCurrency: user.preferredCurrency,
    dateFormat: user.dateFormat,
    pageSize: user.pageSize,
    notificationPreferences: user.notificationPreferences,
    exchangeRates: user.exchangeRates,
    isEmailVerified: user.isEmailVerified,
})

const issueAuthSession = async (user: IUser, res: Response) => {
    const accessToken = generateAccessToken(user._id.toString(), user.tokenVersion)
    const refreshToken = await createRefreshToken(user._id.toString())
    setRefreshTokenCookie(res, refreshToken)

    return {
        token: accessToken,
        user: toPublicUser(user),
    }
}

export const registerUser = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { fullName, email, password } = req.body

    if (!fullName || !email || !password) {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    const normalizedEmail = normalizeEmail(email)
    const validatedPassword = validatePassword(password)

    const userExists = await User.findOne({ email: normalizedEmail })
    if (userExists) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_ALREADY_EXISTS, 400)
    }

    const user = (await User.create({
        fullName,
        email: normalizedEmail,
        password: validatedPassword,
    })) as IUser

    const verificationToken = await createEmailVerificationForUser(user)
    const verificationUrl = buildEmailVerificationUrl(verificationToken)

    if (isSmtpConfigured()) {
        try {
            await sendEmailVerificationEmail(normalizedEmail, verificationUrl)
        } catch (error) {
            console.error('[email-verification] failed to send email:', error)
        }
    } else {
        logEmailVerificationLink(normalizedEmail, verificationUrl)
    }

    const payload = await issueAuthSession(user, res)

    handleResponses(res, 201, payload)
})

export const loginUser = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const { email, password } = req.body

    if (!email || !password) {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    if (typeof password !== 'string') {
        throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_CREDENTIALS, 400)
    }

    const normalizedEmail = normalizeEmail(email)

    const user = (await User.findOne({ email: normalizedEmail })) as IUser | null
    if (!user) {
        throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_CREDENTIALS, 400)
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
        throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_CREDENTIALS, 400)
    }

    const payload = await issueAuthSession(user, res)
    handleResponses(res, 200, payload)
})

export const refreshAccessToken = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const rawRefreshToken = getRefreshTokenFromRequest(req.cookies ?? {})

    if (!rawRefreshToken) {
        throw new CustomError(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_MISSING, 401)
    }

    const { userId, newRefreshToken } = await rotateRefreshToken(rawRefreshToken)
    const user = (await User.findById(userId)) as IUser | null

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 401)
    }

    setRefreshTokenCookie(res, newRefreshToken)
    const accessToken = generateAccessToken(user._id.toString(), user.tokenVersion)

    handleResponses(res, 200, {
        token: accessToken,
        user: toPublicUser(user),
    })
})

export const logoutUser = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const rawRefreshToken = getRefreshTokenFromRequest(req.cookies ?? {})

    if (rawRefreshToken) {
        await revokeRefreshToken(rawRefreshToken)
    }

    clearRefreshTokenCookie(res)
    handleResponses(res, 200, { message: 'Logged out successfully' })
})

export const logoutAllSessions = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString()
    if (!userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 401)
    }

    const user = (await User.findById(userId)) as IUser | null
    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    user.tokenVersion += 1
    await user.save()
    await revokeAllRefreshTokensForUser(userId)

    clearRefreshTokenCookie(res)
    handleResponses(res, 200, { message: 'All sessions revoked successfully' })
})

export const getUserInfo = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id

    const user = (await User.findById(userId)) as IUser | null

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    handleResponses(res, 200, toPublicUser(user))
})

export const updateUserPreferences = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id

    const user = (await User.findById(userId)) as IUser | null

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    const { preferredCurrency, dateFormat, pageSize, timezone, notificationPreferences } = req.body

    let preferredCurrencyChanged = false

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
            throw new CustomError('Invalid timezone', 400)
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

export const requestPasswordReset = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const { email } = req.body

    if (!email) {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    const normalizedEmail = normalizeEmail(email)

    const resetToken = await createPasswordResetForUser(normalizedEmail)

    if (resetToken) {
        const resetUrl = buildPasswordResetUrl(resetToken)

        if (isSmtpConfigured()) {
            try {
                await sendPasswordResetEmail(normalizedEmail, resetUrl)
            } catch (error) {
                console.error('[password-reset] failed to send email:', error)
            }
        } else {
            logPasswordResetLink(normalizedEmail, resetUrl)
        }
    }

    handleResponses(res, 200, {
        message: ERROR_MESSAGES.AUTH.PASSWORD_RESET_EMAIL_SENT,
    })
})

export const confirmPasswordReset = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const { token, password } = req.body

    if (!token || !password) {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    const validatedPassword = validatePassword(password)

    try {
        await resetPasswordWithToken(token, validatedPassword)
    } catch (error) {
        if (error instanceof CustomError) {
            throw error
        }
        throw new CustomError(ERROR_MESSAGES.AUTH.PASSWORD_RESET_INVALID, 400)
    }

    handleResponses(res, 200, { message: 'Password reset successfully' })
})

export const confirmEmailVerification = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const { token } = req.body

    if (!token) {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    await verifyEmailWithToken(token)

    handleResponses(res, 200, { message: 'Email verified successfully' })
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

export const resendEmailVerification = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id
    const user = (await User.findById(userId)) as IUser | null

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    if (user.isEmailVerified) {
        handleResponses(res, 200, { message: ERROR_MESSAGES.AUTH.EMAIL_ALREADY_VERIFIED })
        return
    }

    const verificationToken = await createEmailVerificationForUser(user)
    const verificationUrl = buildEmailVerificationUrl(verificationToken)

    if (isSmtpConfigured()) {
        try {
            await sendEmailVerificationEmail(user.email, verificationUrl)
        } catch (error) {
            console.error('[email-verification] failed to send email:', error)
        }
    } else {
        logEmailVerificationLink(user.email, verificationUrl)
    }

    handleResponses(res, 200, { message: ERROR_MESSAGES.AUTH.EMAIL_VERIFICATION_SENT })
})
