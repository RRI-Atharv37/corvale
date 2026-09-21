import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '@core/access/applyRowLevelSecurity'
import {
    GRANDFATHER_KINDS,
    PLAN_CODES,
    SUBSCRIPTION_STATUSES,
    type GrandfatherKind,
    type PlanCode,
    type SubscriptionStatus,
} from '@core/billing/constants'
import { DUNNING_STAGES, type DunningStage } from '@core/billing/dunning'
import { RETENTION_STAGES, type RetentionStage } from '@core/billing/retention'

export interface ISubscription extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    planCode: PlanCode
    status: SubscriptionStatus
    trialEndsAt: Date | null
    currentPeriodEnd: Date | null
    cancelAtPeriodEnd: boolean
    pastDueSince: Date | null
    dunningStage: DunningStage | null
    lapsedAt: Date | null
    retentionStage: RetentionStage | null
    retentionStageAt: Date | null
    grandfatherKind: GrandfatherKind | null
    providerCustomerId: string | null
    providerSubscriptionId: string | null
    lastEventAt: Date | null
    createdAt: Date
    updatedAt: Date
}

const SubscriptionSchema = new Schema<ISubscription>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
        planCode: { type: String, enum: PLAN_CODES, required: true },
        status: { type: String, enum: SUBSCRIPTION_STATUSES, required: true },
        trialEndsAt: { type: Date, default: null },
        currentPeriodEnd: { type: Date, default: null },
        cancelAtPeriodEnd: { type: Boolean, default: false },
        pastDueSince: { type: Date, default: null },
        dunningStage: { type: String, enum: [null, ...DUNNING_STAGES], default: null },
        lapsedAt: { type: Date, default: null },
        retentionStage: { type: String, enum: [null, ...RETENTION_STAGES], default: null },
        retentionStageAt: { type: Date, default: null },
        grandfatherKind: { type: String, enum: [null, ...GRANDFATHER_KINDS], default: null },
        providerCustomerId: { type: String, default: null },
        providerSubscriptionId: { type: String, default: null },
        lastEventAt: { type: Date, default: null },
    },
    { timestamps: true }
)

// Partial so the many rows with no provider link yet (trials) don't collide on null.
SubscriptionSchema.index(
    { providerSubscriptionId: 1 },
    { unique: true, partialFilterExpression: { providerSubscriptionId: { $type: 'string' } } }
)
SubscriptionSchema.index(
    { providerCustomerId: 1 },
    { unique: true, partialFilterExpression: { providerCustomerId: { $type: 'string' } } }
)
SubscriptionSchema.index({ status: 1, trialEndsAt: 1 })
SubscriptionSchema.index({ status: 1, lapsedAt: 1 })

applyRowLevelSecurity(SubscriptionSchema)

const Subscription: Model<ISubscription> = mongoose.model<ISubscription>('Subscription', SubscriptionSchema)
export default Subscription
