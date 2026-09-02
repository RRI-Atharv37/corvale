import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '@core/access/applyRowLevelSecurity'
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from '@core/money/currencyUtils'

export const BUDGET_PERIOD_TYPES = ['monthly', 'custom'] as const
export type BudgetPeriodType = (typeof BUDGET_PERIOD_TYPES)[number]

export interface IBudget extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
    name?: string
    periodType: BudgetPeriodType
    periodStart: Date
    periodEnd: Date
    categoryId?: Types.ObjectId | null
    amount: number
    currency: string
    rollover: boolean
    accountIds: Types.ObjectId[]
    isArchived: boolean
    /** See `Transaction.createdByRemovedUser` - same meaning, same sentinel `userId`. */
    createdByRemovedUser?: boolean
    createdAt: Date
    updatedAt: Date
}

const BudgetSchema = new Schema<IBudget>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },
        name: { type: String, trim: true },
        periodType: { type: String, enum: BUDGET_PERIOD_TYPES, required: true },
        periodStart: { type: Date, required: true },
        periodEnd: { type: Date, required: true },
        categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
        amount: { type: Number, required: true, min: 1 },
        currency: {
            type: String,
            enum: SUPPORTED_CURRENCIES,
            required: true,
            default: DEFAULT_CURRENCY,
            uppercase: true,
            trim: true,
        },
        rollover: { type: Boolean, default: false },
        accountIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Account' }],
        isArchived: { type: Boolean, default: false },
        createdByRemovedUser: { type: Boolean, default: false },
    },
    { timestamps: true }
)

BudgetSchema.index({ userId: 1, periodStart: -1 })
BudgetSchema.index({ userId: 1, categoryId: 1, periodStart: -1 })
BudgetSchema.index({ userId: 1, isArchived: 1, periodStart: -1 })
BudgetSchema.index({ userId: 1, updatedAt: 1, _id: 1 })
BudgetSchema.index({ workspaceId: 1, updatedAt: 1, _id: 1 })

applyRowLevelSecurity(BudgetSchema, { supportsWorkspace: true })

const Budget: Model<IBudget> = mongoose.model<IBudget>('Budget', BudgetSchema)
export default Budget
