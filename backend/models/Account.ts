import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '../utils/applyRowLevelSecurity'
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from '../utils/currencyUtils'

export const ACCOUNT_TYPES = ['checking', 'cash', 'credit', 'savings'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export interface IAccount extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
    name: string
    type: AccountType
    currency: string
    openingBalance: number
    currentBalance: number
    isDefault: boolean
    isArchived: boolean
    interestRate?: number
    minimumPayment?: number
    createdAt: Date
    updatedAt: Date
}

const AccountSchema = new Schema<IAccount>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },
        name: { type: String, required: true, trim: true },
        type: { type: String, enum: ACCOUNT_TYPES, required: true },
        currency: {
            type: String,
            enum: SUPPORTED_CURRENCIES,
            required: true,
            default: DEFAULT_CURRENCY,
            uppercase: true,
            trim: true,
        },
        openingBalance: { type: Number, required: true, default: 0 },
        currentBalance: { type: Number, required: true, default: 0 },
        isDefault: { type: Boolean, default: false },
        isArchived: { type: Boolean, default: false },
        interestRate: { type: Number, min: 0 },
        minimumPayment: { type: Number, min: 0 },
    },
    { timestamps: true }
)

AccountSchema.index({ userId: 1, isArchived: 1 })
AccountSchema.index({ userId: 1, updatedAt: 1, _id: 1 })
AccountSchema.index({ workspaceId: 1, updatedAt: 1, _id: 1 })
AccountSchema.index(
    { userId: 1, isDefault: 1 },
    { unique: true, partialFilterExpression: { isDefault: true, isArchived: false } }
)

applyRowLevelSecurity(AccountSchema, { supportsWorkspace: true })

const Account: Model<IAccount> = mongoose.model<IAccount>('Account', AccountSchema)
export default Account
