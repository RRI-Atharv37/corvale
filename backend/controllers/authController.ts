import dotenv from 'dotenv'
dotenv.config()

import User, {IUser} from '../models/User'
import jwt from 'jsonwebtoken'
import {Request, Response} from 'express'
import { AuthRequest } from '../middleware/authMiddleware'

const generateToken = (userId: string) => {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET as string, {expiresIn: '1h',})
}

export const registerUser = async (req: Request, res: Response): Promise<void> => {
    const { fullName, email, password } = req.body

    if (!fullName || !email || !password) {
        res.status(400).json({ message: 'Please fill in all fields' })
        return
    }

    try {
        const userExists = await User.findOne({ email })
        if (userExists) {
            res.status(400).json({ message: 'User already exists' })
            return
        }

        const user = await User.create({ fullName, email, password }) as IUser
        const token = generateToken(user._id.toString())

        res.status(201).json({
            _id: user._id,
            fullName: user.fullName,
            email: user.email,
            token,
        })
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: (error as Error).message })
    }
}

export const loginUser = async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body

    if (!email || !password) {
        res.status(400).json({ message: 'Please fill in all fields' })
        return
    }

    try {
        const user = await User.findOne({ email }) as IUser
        if (!user) {
            res.status(400).json({ message: 'Invalid credentials' })
            return
        }

        const isMatch = await user.comparePassword(password)
        if (!isMatch) {
            res.status(400).json({ message: 'Invalid credentials' })
            return
        }

        const token = generateToken(user._id.toString())

        res.status(200).json({
            _id: user._id,
            fullName: user.fullName,
            email: user.email,
            token
        })
    } catch (error) {
        res.status(500).json({ message: 'Server error' , error: (error as Error).message })
    }
}

export const getUserInfo = async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id

    try {
        const user = await User.findById(userId).select('-password') as IUser

        if (!user) {
            res.status(404).json({ message: 'User not found' })
            return
        }
        
        res.status(200).json(user)
    } catch (error) {
        res.status(500).json({ message: 'Server error' , error: (error as Error).message })
    }
}
