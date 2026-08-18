import mongoose, { Document, Model, Schema, Types } from 'mongoose'

export const CATEGORIZATION_MATCH_TYPES = [
    'description_contains',
    'description_equals',
    'amount_range',
    'account_id',
] as const
export type CategorizationMatchType = (typeof CATEGORIZATION_MATCH_TYPES)[number]

export interface ICategorizationRule extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    name: string
    matchType: CategorizationMatchType
    matchValue?: string
    amountMin?: number
    amountMax?: number
    accountId?: Types.ObjectId
    categoryId: Types.ObjectId
    tags?: string[]
    priority: number
    isActive: boolean
    createdAt: Date
    updatedAt: Date
}

const CategorizationRuleSchema = new Schema<ICategorizationRule>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true, trim: true },
        matchType: { type: String, enum: CATEGORIZATION_MATCH_TYPES, required: true },
        matchValue: { type: String, trim: true },
        amountMin: { type: Number, min: 0 },
        amountMax: { type: Number, min: 0 },
        accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
        categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
        tags: [{ type: String, trim: true }],
        priority: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
)

CategorizationRuleSchema.index({ userId: 1, priority: -1, isActive: 1 })

const CategorizationRule: Model<ICategorizationRule> = mongoose.model<ICategorizationRule>(
    'CategorizationRule',
    CategorizationRuleSchema
)
export default CategorizationRule
