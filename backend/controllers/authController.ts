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
import { parseSupportedCurrency } from '../utils/currencyUtils'
import { isValidTimezone } from '../utils/timezoneUtils'

const toPublicUser = (user: IUser) => ({
    _id: user._id,
    fullName: user.fullName,
    email: user.email,
    timezone: user.timezone,
    preferredCurrency: user.preferredCurrency,
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

    if (password.length < 8) {
        throw new CustomError(ERROR_MESSAGES.AUTH.PASSWORD_TOO_SHORT, 400)
    }

    const userExists = await User.findOne({ email })
    if (userExists) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_ALREADY_EXISTS, 400)
    }

    const user = (await User.create({ fullName, email, password })) as IUser
    const payload = await issueAuthSession(user, res)

    handleResponses(res, 201, payload)
})

export const loginUser = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const { email, password } = req.body

    if (!email || !password) {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    const user = (await User.findOne({ email })) as IUser | null
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

    const user = (await User.findById(userId).select('-password')) as IUser | null

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    handleResponses(res, 200, user)
})

export const updateUserPreferences = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id

    const user = (await User.findById(userId)) as IUser | null

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    const { preferredCurrency, timezone } = req.body

    if (preferredCurrency !== undefined) {
        user.preferredCurrency = parseSupportedCurrency(preferredCurrency)
    }

    if (timezone !== undefined) {
        if (typeof timezone !== 'string' || !timezone.trim() || !isValidTimezone(timezone.trim())) {
            throw new CustomError('Invalid timezone', 400)
        }
        user.timezone = timezone.trim()
    }

    await user.save()

    handleResponses(res, 200, toPublicUser(user))
})

export const requestPasswordReset = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const { email } = req.body

    if (!email) {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    const resetToken = await createPasswordResetForUser(email)

    if (resetToken) {
        const resetUrl = buildPasswordResetUrl(resetToken)
        logPasswordResetLink(email, resetUrl)
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

    if (password.length < 8) {
        throw new CustomError(ERROR_MESSAGES.AUTH.PASSWORD_TOO_SHORT, 400)
    }

    try {
        await resetPasswordWithToken(token, password)
    } catch (error) {
        if (error instanceof CustomError) {
            throw error
        }
        throw new CustomError(ERROR_MESSAGES.AUTH.PASSWORD_RESET_INVALID, 400)
    }

    handleResponses(res, 200, { message: 'Password reset successfully' })
})
