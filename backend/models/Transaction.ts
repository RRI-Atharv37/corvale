import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '@core/access/applyRowLevelSecurity'
import { applySoftDelete } from '@core/softDelete/applySoftDelete'

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
    /**
     * Stable per-transaction id from an imported bank file (OFX `FITID`). Used as an exact
     * dedupe key on re-import — `importController.ts` matches it against this field before the
     * fuzzy date/amount/description fingerprint (BUG-21). Absent for manually-created rows.
     */
    externalId?: string
    /**
     * Set (with `userId` rewritten to the reserved `REMOVED_MEMBER_USER_ID` sentinel - see
     * `accountDeletionUtils.ts`) when this record's creator deleted their account but the
     * workspace it lives in still has other members. The record is retained for them; this flag
     * marks it as no longer anyone's personal data rather than pretending `userId` still
     * identifies a real account.
     */
    createdByRemovedUser?: boolean
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
        externalId: { type: String, trim: true },
        createdByRemovedUser: { type: Boolean, default: false },
    },
    { timestamps: true }
)

TransactionSchema.index({ userId: 1, date: -1 })
TransactionSchema.index({ userId: 1, type: 1, date: -1 })
TransactionSchema.index({ userId: 1, categoryId: 1, date: -1 })
TransactionSchema.index({ userId: 1, accountId: 1, date: -1 })
TransactionSchema.index({ userId: 1, tags: 1 })
// Sparse: only imported rows carry `externalId`. Backs the re-import FITID dedupe lookup (BUG-21).
TransactionSchema.index({ userId: 1, accountId: 1, externalId: 1 }, { sparse: true })
TransactionSchema.index({ userId: 1, updatedAt: 1, _id: 1 })
TransactionSchema.index({ workspaceId: 1, updatedAt: 1, _id: 1 })
// Mirrors the userId-scoped report indexes above: report/dashboard aggregations run the same
// {type, date-range} and {date-range}-only filters against workspaceId when a workspace is
// active (see workspaceUtils.buildScopedListFilter), and had no compound index to use.
TransactionSchema.index({ workspaceId: 1, type: 1, date: -1 })
TransactionSchema.index({ workspaceId: 1, date: -1 })

applyRowLevelSecurity(TransactionSchema, { supportsWorkspace: true })
applySoftDelete(TransactionSchema)

const Transaction: Model<ITransaction> = mongoose.model<ITransaction>(
    'Transaction',
    TransactionSchema
)
export default Transaction
