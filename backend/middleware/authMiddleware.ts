import dotenv from 'dotenv'
dotenv.config()

import jwt from 'jsonwebtoken'
import User, {IUser} from '../models/User'
import { Request, Response, NextFunction } from 'express'

export interface AuthRequest extends Request {
    user?: IUser
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ message: 'Not authorized, no token' })
        return
    }
    const token = authHeader.split(' ')[1]

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string }

        const user = await User.findById(decoded.id).select('-password')
        if(!user) {
            res.status(401).json({ message: 'Not authorized, no user found' })
            return
        }

        req.user = user
        return next()
    } catch (error) {
        res.status(401).json({ message: 'Not authorized, token failed', error: (error as Error).message })
    }
}