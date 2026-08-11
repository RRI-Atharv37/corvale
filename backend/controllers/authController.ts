import dotenv from 'dotenv'
dotenv.config()

import asyncHandler from 'express-async-handler'
import jwt, { SignOptions } from 'jsonwebtoken'
import User, { IUser } from '../models/User'
import { Response } from 'express'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { handleResponses } from '../utils/authUtils'

const generateToken = (userId: string): string => {
    if (!process.env.JWT_SECRET) {
        throw new CustomError(ERROR_MESSAGES.GENERAL.JWT_SECRET_MISSING, 500)
    }
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRY as string,
    } as SignOptions)
}

export const registerUser = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { fullName, email, password } = req.body

    if (!fullName || !email || !password) {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    const userExists = await User.findOne({ email })
    if (userExists) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_ALREADY_EXISTS, 400)
    }

    const user = (await User.create({ fullName, email, password })) as IUser
    const token = generateToken(user._id.toString())

    handleResponses(res, 201, {
        token,
        user: {
            _id: user._id,
            fullName: user.fullName,
            email: user.email,
        },
    })
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

    const token = generateToken(user._id.toString())

    handleResponses(res, 200, {
        token,
        user: {
            _id: user._id,
            fullName: user.fullName,
            email: user.email,
        },
    })
})

export const getUserInfo = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id

    const user = (await User.findById(userId).select('-password')) as IUser | null

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    handleResponses(res, 200, user)
})
