import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { GRANDFATHER_KINDS, PLAN_CODES, SUBSCRIPTION_STATUSES } from '@core/billing/constants'
import { METRIC_FLOW_FIELDS, type MetricFlows, type MetricStock, type MetricStockSegment } from '@core/billing/metrics'

import { BILLING_INTERVALS } from './providers/billingProvider'

export interface IMetricDaily extends Document {
    _id: Types.ObjectId
    /** UTC calendar day, `YYYY-MM-DD`. */
    date: string
    /** Set once the first run after this day's 00:00 UTC has landed the stock snapshot; a closed day's stock never changes again. */
    closed: boolean
    /** Stamped when a flow counter on an already-closed day is incremented by a late-arriving event. */
    flowRevisedAt: Date | null
    flows: MetricFlows
    stock: MetricStock | null
    createdAt: Date
    updatedAt: Date
}

const flowsSchema = new Schema(
    Object.fromEntries(METRIC_FLOW_FIELDS.map((field) => [field, { type: Number, default: 0, min: 0 }])),
    { _id: false }
)

const stockSegmentSchema = new Schema<MetricStockSegment>(
    {
        planCode: { type: String, enum: PLAN_CODES, required: true },
        status: { type: String, enum: SUBSCRIPTION_STATUSES, required: true },
        interval: { type: String, enum: [null, ...BILLING_INTERVALS], default: null },
        grandfatherKind: { type: String, enum: [null, ...GRANDFATHER_KINDS], default: null },
        count: { type: Number, required: true, min: 0 },
    },
    { _id: false }
)

const stockSchema = new Schema<MetricStock>(
    {
        asOf: { type: Date, required: true },
        segments: { type: [stockSegmentSchema], required: true },
        listPriceMrrMinor: { type: Number, required: true, min: 0 },
        atRiskMrrMinor: { type: Number, required: true, min: 0 },
    },
    { _id: false }
)

const MetricDailySchema = new Schema<IMetricDaily>(
    {
        date: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
        closed: { type: Boolean, default: false },
        flowRevisedAt: { type: Date, default: null },
        flows: { type: flowsSchema, default: () => ({}) },
        stock: { type: stockSchema, default: null },
    },
    { timestamps: true }
)

MetricDailySchema.index({ date: -1 })

// System collection: anonymous, no userId, so the row-level-security plugin is deliberately not applied
// (same footing as Plan/JobRun) - it survives account erasure by design (M7b).
const MetricDaily: Model<IMetricDaily> = mongoose.model<IMetricDaily>('MetricDaily', MetricDailySchema)
export default MetricDaily
