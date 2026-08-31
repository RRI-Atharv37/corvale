import crypto from 'crypto'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'
import User from '../models/User'
import { hashToken } from './tokenUtils'
import { revokeAllRefreshTokensForUser } from './refreshTokenService'
import { logMailDevLink } from './mailDevLog'

const PASSWORD_RESET_EXPIRY_MS = Number(process.env.PASSWORD_RESET_EXPIRY_MS ?? 600_000)

export const generatePasswordResetToken = (): string => {
    return crypto.randomBytes(32).toString('hex')
}

export const buildPasswordResetUrl = (token: string): string => {
    const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173'
    return `${clientUrl}/reset-password?token=${token}`
}

export const createPasswordResetForUser = async (email: string): Promise<string | null> => {
    const user = await User.findOne({ email })
    if (!user) {
        return null
    }

    const rawToken = generatePasswordResetToken()
    user.passwordResetTokenHash = hashToken(rawToken)
    user.passwordResetExpires = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS)
    await user.save()

    return rawToken
}

export const resetPasswordWithToken = async (rawToken: string, newPassword: string): Promise<void> => {
    const tokenHash = hashToken(rawToken)
    const user = await User.findOne({
        passwordResetTokenHash: tokenHash,
        passwordResetExpires: { $gt: new Date() },
    })

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.AUTH.PASSWORD_RESET_INVALID, 400)
    }

    user.password = newPassword
    user.passwordResetTokenHash = undefined
    user.passwordResetExpires = undefined
    user.tokenVersion += 1
    await user.save()

    await revokeAllRefreshTokensForUser(user._id.toString())
}

export const logPasswordResetLink = (email: string, resetUrl: string): void => {
    logMailDevLink('password-reset', email, resetUrl)
}
