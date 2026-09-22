import mongoose, { Document, Model, Schema, Types } from 'mongoose'

export interface IProviderPayout extends Document {
    _id: Types.ObjectId
    /** UTC `YYYY-MM` - the calendar month this payout is reconciled against, same granularity as `DeferredRevenueEntry.recognitionMonth`. */
    periodMonth: string
    currency: string
    /** Minor units, as the MoR reported it - admin-entered until a real payout API exists (no live MoR account yet, M0). */
    reportedPayoutMinor: number
    note: string | null
    /** M8d's field: the bank's FIRC/FIRA reference for this payout cycle, filled in once real payouts start. */
    firc: string | null
    bankDepositRef: string | null
    bankDepositDate: Date | null
    bankDepositAmountMinor: number | null
    recordedByAdminId: Types.ObjectId | null
    createdAt: Date
    updatedAt: Date
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

const ProviderPayoutSchema = new Schema<IProviderPayout>(
    {
        periodMonth: { type: String, required: true, match: MONTH_PATTERN, immutable: true },
        currency: { type: String, required: true, immutable: true },
        reportedPayoutMinor: { type: Number, required: true, min: 0 },
        note: { type: String, default: null },
        firc: { type: String, default: null },
        bankDepositRef: { type: String, default: null },
        bankDepositDate: { type: Date, default: null },
        bankDepositAmountMinor: { type: Number, default: null, min: 0 },
        recordedByAdminId: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
    },
    { timestamps: true }
)

// One payout record per MoR-reported period per currency (M8f).
ProviderPayoutSchema.index({ periodMonth: 1, currency: 1 }, { unique: true })

// System collection like BillingEvent/DeferredRevenueEntry: no userId, and one row per
// period+currency rather than per customer, so it carries no subscriber-level detail - the
// row-level-security plugin does not apply.
const ProviderPayout: Model<IProviderPayout> = mongoose.model<IProviderPayout>('ProviderPayout', ProviderPayoutSchema)
export default ProviderPayout
