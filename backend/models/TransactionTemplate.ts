import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { TRANSACTION_TYPES, TransactionType } from './Transaction'

const TEMPLATE_TYPES = TRANSACTION_TYPES.filter((type) => type !== 'transfer') as Exclude<
    TransactionType,
    'transfer'
>[]

export type TransactionTemplateType = (typeof TEMPLATE_TYPES)[number]

export interface ITransactionTemplate extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    name: string
    type: TransactionTemplateType
    amount: number
    accountId: Types.ObjectId
    categoryId: Types.ObjectId
    tags?: string[]
    description?: string
    createdAt: Date
    updatedAt: Date
}

const TransactionTemplateSchema = new Schema<ITransactionTemplate>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true, trim: true },
        type: { type: String, enum: TEMPLATE_TYPES, required: true },
        amount: { type: Number, required: true, min: 1 },
        accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
        categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
        tags: [{ type: String, trim: true }],
        description: { type: String, trim: true },
    },
    { timestamps: true }
)

TransactionTemplateSchema.index({ userId: 1, name: 1 })

const TransactionTemplate: Model<ITransactionTemplate> = mongoose.model<ITransactionTemplate>(
    'TransactionTemplate',
    TransactionTemplateSchema
)
export default TransactionTemplate
