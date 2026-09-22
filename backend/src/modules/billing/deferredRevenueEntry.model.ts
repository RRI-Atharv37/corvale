import mongoose, { Document, Model, Query, Schema, Types } from 'mongoose'

import { PLAN_CODES, type PlanCode } from '@core/billing/constants'

export interface IDeferredRevenueEntry extends Document {
    _id: Types.ObjectId
    /** The `BillingEvent.providerEventId` of the annual payment this bucket was split from. */
    sourceEventId: string
    providerSubscriptionId: string
    planCode: PlanCode
    /** 1-12: which month of the paid year this bucket recognizes. */
    bucketIndex: number
    /** UTC `YYYY-MM` the bucket's amount is recognized in. */
    recognitionMonth: string
    recognizedAmountMinor: number
    currency: string
    paymentOccurredAt: Date
    createdAt: Date
    updatedAt: Date
}

const APPEND_ONLY_UPDATE = 'DeferredRevenueEntry is append-only: recorded fields cannot be rewritten'
const APPEND_ONLY_DELETE = 'DeferredRevenueEntry is append-only: deletes are refused'

const DeferredRevenueEntrySchema = new Schema<IDeferredRevenueEntry>(
    {
        sourceEventId: { type: String, required: true, immutable: true },
        providerSubscriptionId: { type: String, required: true, immutable: true },
        planCode: { type: String, enum: PLAN_CODES, required: true, immutable: true },
        bucketIndex: { type: Number, required: true, min: 1, max: 12, immutable: true },
        recognitionMonth: { type: String, required: true, match: /^\d{4}-\d{2}$/, immutable: true },
        recognizedAmountMinor: { type: Number, required: true, min: 0, immutable: true },
        currency: { type: String, required: true, immutable: true },
        paymentOccurredAt: { type: Date, required: true, immutable: true },
    },
    { timestamps: true }
)

// One bucket per (event, month-of-year) - defence in depth alongside the sweep's atomic claim on BillingEvent.
DeferredRevenueEntrySchema.index({ sourceEventId: 1, bucketIndex: 1 }, { unique: true })
DeferredRevenueEntrySchema.index({ recognitionMonth: 1 })

const refuseRewrite = (next: (err?: Error) => void): void => next(new Error(APPEND_ONLY_UPDATE))
const refuseDelete = (next: (err?: Error) => void): void => next(new Error(APPEND_ONLY_DELETE))

for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'] as const) {
    DeferredRevenueEntrySchema.pre(operation, function (this: Query<unknown, unknown>, next: (err?: Error) => void) {
        refuseRewrite(next)
    })
}
for (const operation of ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
    DeferredRevenueEntrySchema.pre(operation, function (this: Query<unknown, unknown>, next: (err?: Error) => void) {
        refuseDelete(next)
    })
}
DeferredRevenueEntrySchema.pre('deleteOne', { document: true, query: false }, (next) => refuseDelete(next))

// System collection, zero PII by construction (M8e / the CA-ready export): no userId, so the
// row-level-security plugin is deliberately not applied - same footing as BillingEvent/MetricDaily.
const DeferredRevenueEntry: Model<IDeferredRevenueEntry> = mongoose.model<IDeferredRevenueEntry>('DeferredRevenueEntry', DeferredRevenueEntrySchema)
export default DeferredRevenueEntry
