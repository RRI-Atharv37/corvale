import crypto from 'crypto'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'
import User, { IUser } from '../models/User'
import { hashToken } from './tokenUtils'

const EMAIL_VERIFICATION_EXPIRY_MS = Number(process.env.EMAIL_VERIFICATION_EXPIRY_MS ?? 86_400_000)

export const generateEmailVerificationToken = (): string => {
    return crypto.randomBytes(32).toString('hex')
}

export const buildEmailVerificationUrl = (token: string): string => {
    const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173'
    return `${clientUrl}/verify-email?token=${token}`
}

export const createEmailVerificationForUser = async (user: IUser): Promise<string> => {
    const rawToken = generateEmailVerificationToken()
    user.emailVerificationTokenHash = hashToken(rawToken)
    user.emailVerificationExpires = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS)
    await user.save()

    return rawToken
}

export const verifyEmailWithToken = async (rawToken: string): Promise<void> => {
    const tokenHash = hashToken(rawToken)
    const user = await User.findOne({
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpires: { $gt: new Date() },
    })

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.AUTH.EMAIL_VERIFICATION_INVALID, 400)
    }

    user.isEmailVerified = true
    user.emailVerificationTokenHash = undefined
    user.emailVerificationExpires = undefined
    await user.save()
}

export const logEmailVerificationLink = (email: string, verifyUrl: string): void => {
    if (process.env.NODE_ENV === 'production') {
        console.info(`[email-verification] verification requested for ${email}`)
        return
    }

    console.info(`[email-verification] ${email}: ${verifyUrl}`)
}
