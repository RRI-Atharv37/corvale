import RefreshToken from '../models/RefreshToken'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'
import { generateRefreshTokenValue, getRefreshTokenMaxAgeMs, hashToken } from './tokenUtils'

export const createRefreshToken = async (userId: string): Promise<string> => {
    const rawToken = generateRefreshTokenValue()
    const expiresAt = new Date(Date.now() + getRefreshTokenMaxAgeMs())

    await RefreshToken.create({
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt,
    })

    return rawToken
}

export const findValidRefreshToken = async (rawToken: string) => {
    const tokenHash = hashToken(rawToken)
    const record = await RefreshToken.findOne({
        tokenHash,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
    })

    if (!record) {
        throw new CustomError(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_INVALID, 401)
    }

    return record
}

export const revokeRefreshToken = async (rawToken: string): Promise<void> => {
    const tokenHash = hashToken(rawToken)
    await RefreshToken.updateOne({ tokenHash, revokedAt: null }, { revokedAt: new Date() })
}

export const revokeAllRefreshTokensForUser = async (userId: string): Promise<void> => {
    await RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() })
}

export const rotateRefreshToken = async (rawToken: string): Promise<{ userId: string; newRefreshToken: string }> => {
    const record = await findValidRefreshToken(rawToken)

    record.revokedAt = new Date()
    await record.save()

    const newRefreshToken = await createRefreshToken(record.userId.toString())

    return {
        userId: record.userId.toString(),
        newRefreshToken,
    }
}
