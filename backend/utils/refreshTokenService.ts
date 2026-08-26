import mongoose from 'mongoose'
import RefreshToken from '../models/RefreshToken'
import User from '../models/User'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'
import { generateRefreshTokenValue, getRefreshTokenMaxAgeMs, hashToken } from './tokenUtils'

export const createRefreshToken = async (userId: string, familyId?: mongoose.Types.ObjectId): Promise<string> => {
    const rawToken = generateRefreshTokenValue()
    const expiresAt = new Date(Date.now() + getRefreshTokenMaxAgeMs())
    const _id = new mongoose.Types.ObjectId()

    await RefreshToken.create({
        _id,
        userId,
        tokenHash: hashToken(rawToken),
        familyId: familyId ?? _id,
        expiresAt,
    })

    return rawToken
}

export const revokeRefreshToken = async (rawToken: string): Promise<void> => {
    const tokenHash = hashToken(rawToken)
    await RefreshToken.updateOne({ tokenHash, revokedAt: null }, { revokedAt: new Date() })
}

export const revokeAllRefreshTokensForUser = async (userId: string): Promise<void> => {
    await RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() })
}

const revokeRefreshTokenFamily = async (familyId: mongoose.Types.ObjectId): Promise<void> => {
    await RefreshToken.updateMany({ familyId, revokedAt: null }, { revokedAt: new Date() })
}

export const rotateRefreshToken = async (rawToken: string): Promise<{ userId: string; newRefreshToken: string }> => {
    const tokenHash = hashToken(rawToken)
    const record = await RefreshToken.findOne({ tokenHash })

    if (!record) {
        throw new CustomError(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_INVALID, 401)
    }

    if (record.revokedAt) {
        await revokeRefreshTokenFamily(record.familyId)
        await User.updateOne({ _id: record.userId }, { $inc: { tokenVersion: 1 } })
        throw new CustomError(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_REUSED, 401)
    }

    if (record.expiresAt <= new Date()) {
        throw new CustomError(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_INVALID, 401)
    }

    record.revokedAt = new Date()
    await record.save()

    const newRefreshToken = await createRefreshToken(record.userId.toString(), record.familyId)

    return {
        userId: record.userId.toString(),
        newRefreshToken,
    }
}
