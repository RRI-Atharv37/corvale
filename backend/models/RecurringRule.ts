import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '../utils/applyRowLevelSecurity'
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from '../utils/currencyUtils'
import { TRANSACTION_TYPES, TransactionType } from './Transaction'

export const RECURRING_INTERVALS = [
    'daily',
    'weekly',
    'biweekly',
    'monthly',
    'quarterly',
    'yearly',
    'custom',
] as const
export type RecurringInterval = (typeof RECURRING_INTERVALS)[number]

export interface IRecurringRule extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
    title: string
    type: TransactionType
    amount: number
    currency: string
    accountId: Types.ObjectId
    categoryId: Types.ObjectId
    interval: RecurringInterval
    customIntervalDays?: number
    nextDueDate: Date
    description?: string
    paymentMethod?: string
    tags?: string[]
    isActive: boolean
    isArchived: boolean
    isCancelled: boolean
    createdAt: Date
    updatedAt: Date
}

const RecurringRuleSchema = new Schema<IRecurringRule>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },
        title: { type: String, required: true, trim: true },
        type: { type: String, enum: TRANSACTION_TYPES.filter((t) => t !== 'transfer'), required: true },
        amount: { type: Number, required: true, min: 1 },
        currency: {
            type: String,
            enum: SUPPORTED_CURRENCIES,
            required: true,
            default: DEFAULT_CURRENCY,
            uppercase: true,
            trim: true,
        },
        accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
        categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
        interval: { type: String, enum: RECURRING_INTERVALS, required: true },
        customIntervalDays: { type: Number, min: 1 },
        nextDueDate: { type: Date, required: true },
        description: { type: String, trim: true },
        paymentMethod: { type: String, trim: true },
        tags: [{ type: String, trim: true }],
        isActive: { type: Boolean, default: true },
        isArchived: { type: Boolean, default: false },
        isCancelled: { type: Boolean, default: false },
    },
    { timestamps: true }
)

RecurringRuleSchema.index({ userId: 1, nextDueDate: 1 })
RecurringRuleSchema.index({ userId: 1, isArchived: 1, isActive: 1 })

applyRowLevelSecurity(RecurringRuleSchema, { supportsWorkspace: true })

const RecurringRule: Model<IRecurringRule> = mongoose.model<IRecurringRule>(
    'RecurringRule',
    RecurringRuleSchema
)
export default RecurringRule
