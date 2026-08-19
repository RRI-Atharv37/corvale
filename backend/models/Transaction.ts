import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '../utils/applyRowLevelSecurity'
import { applySoftDelete } from '../utils/applySoftDelete'

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer'] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

export const TRANSACTION_STATUSES = ['posted', 'draft'] as const
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number]

export const CLEARED_STATUSES = ['pending', 'cleared', 'reconciled'] as const
export type ClearedStatus = (typeof CLEARED_STATUSES)[number]

export interface ITransaction extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
    accountId: Types.ObjectId
    categoryId: Types.ObjectId
    type: TransactionType
    status: TransactionStatus
    amount: number
    currency: string
    title: string
    description?: string
    date: Date
    source?: string
    paymentMethod?: string
    tags?: string[]
    transferPairId?: Types.ObjectId | null
    splitTransactionId?: Types.ObjectId | null
    recurringPaymentId?: Types.ObjectId | null
    receiptIds?: Types.ObjectId[]
    clearedStatus: ClearedStatus
    reconciledAt?: Date | null
    deletedAt?: Date | null
    createdAt: Date
    updatedAt: Date
}

const TransactionSchema = new Schema<ITransaction>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },
        accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
        categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
        type: { type: String, enum: TRANSACTION_TYPES, required: true },
        status: { type: String, enum: TRANSACTION_STATUSES, default: 'posted' },
        amount: { type: Number, required: true, min: 0 },
        currency: { type: String, required: true, uppercase: true, trim: true },
        title: { type: String, required: true, trim: true },
        description: { type: String, trim: true },
        date: { type: Date, default: Date.now },
        source: { type: String, trim: true },
        paymentMethod: { type: String, trim: true },
        tags: [{ type: String, trim: true }],
        transferPairId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
        splitTransactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Transaction',
            default: null,
        },
        recurringPaymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'RecurringRule',
            default: null,
        },
        receiptIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Receipt' }],
        clearedStatus: { type: String, enum: CLEARED_STATUSES, default: 'pending' },
        reconciledAt: { type: Date, default: null },
    },
    { timestamps: true }
)

TransactionSchema.index({ userId: 1, date: -1 })
TransactionSchema.index({ userId: 1, type: 1, date: -1 })
TransactionSchema.index({ userId: 1, categoryId: 1, date: -1 })
TransactionSchema.index({ userId: 1, accountId: 1, date: -1 })
TransactionSchema.index({ userId: 1, tags: 1 })
TransactionSchema.index({ userId: 1, updatedAt: 1, _id: 1 })
TransactionSchema.index({ workspaceId: 1, updatedAt: 1, _id: 1 })

applyRowLevelSecurity(TransactionSchema, { supportsWorkspace: true })
applySoftDelete(TransactionSchema)

const Transaction: Model<ITransaction> = mongoose.model<ITransaction>(
    'Transaction',
    TransactionSchema
)
export default Transaction
