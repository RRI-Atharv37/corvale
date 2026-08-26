import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '../utils/applyRowLevelSecurity'
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from '../utils/currencyUtils'

export const ACCOUNT_TYPES = ['checking', 'cash', 'credit', 'savings'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const ACCOUNT_BALANCE_UNITS = ['major', 'minor'] as const
export type AccountBalanceUnit = (typeof ACCOUNT_BALANCE_UNITS)[number]

export interface IAccount extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
    name: string
    type: AccountType
    currency: string
    /**
     * openingBalance/currentBalance are stored in the unit balanceUnit names — 'major'
     * (a decimal, e.g. 12.50) for every account created before Sprint C5's migration ran,
     * 'minor' (an integer, e.g. 1250) for one that's been converted, mirroring how
     * Transaction.amount is always minor units. New accounts default to 'major' unchanged
     * (see accountController.createAccount) so migrateAccountBalancesToMinorUnits.ts has a
     * stable, idempotent flag to convert against; every read/write of these two fields must
     * branch on balanceUnit rather than assuming one or the other.
     */
    balanceUnit: AccountBalanceUnit
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
        balanceUnit: { type: String, enum: ACCOUNT_BALANCE_UNITS, default: 'major' },
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
