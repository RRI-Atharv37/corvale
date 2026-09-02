import type { Request } from 'express'
import type { IUser } from '@modules/users'

export interface AuthRequest extends Request {
    user?: IUser
}
