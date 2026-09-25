import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '@core/access/applyRowLevelSecurity'
import {
    GRANDFATHER_KINDS,
    LIMIT_KEYS,
    PLAN_CODES,
    SUBSCRIPTION_STATUSES,
    type GrandfatherKind,
    type PlanCode,
    type SubscriptionStatus,
} from '@core/billing/constants'
import { ADMIN_GRANT_KINDS, type AdminGrantSnapshot } from '@core/billing/entitlements'
import { DUNNING_STAGES, type DunningStage } from '@core/billing/dunning'
import { LIFECYCLE_EMAIL_STAGES, type LifecycleEmailStage } from '@core/billing/lifecycleEmail'
import { RETENTION_STAGES, type RetentionStage } from '@core/billing/retention'

import { BILLING_INTERVALS, type BillingInterval } from './providers/billingProvider'

export interface ISubscriptionAdminGrant extends AdminGrantSnapshot {
    grantedBy: Types.ObjectId
    grantedAt: Date
}

export interface ISubscription extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    planCode: PlanCode
    status: SubscriptionStatus
    /** Set once a provider webhook has stated it; null for a Corvale-run trial the provider has never seen. */
    interval: BillingInterval | null
    trialEndsAt: Date | null
    currentPeriodEnd: Date | null
    cancelAtPeriodEnd: boolean
    pastDueSince: Date | null
    dunningStage: DunningStage | null
    lifecycleEmailStage: LifecycleEmailStage | null
    lapsedAt: Date | null
    retentionStage: RetentionStage | null
    retentionStageAt: Date | null
    grandfatherKind: GrandfatherKind | null
    adminGrant: ISubscriptionAdminGrant | null
    retentionHoldUntil: Date | null
    providerCustomerId: string | null
    providerSubscriptionId: string | null
    lastEventAt: Date | null
    createdAt: Date
    updatedAt: Date
}

const limitsSchema = new Schema(
    Object.fromEntries(LIMIT_KEYS.map((key) => [key, { type: Number, default: undefined }])),
    { _id: false }
)

const adminGrantSchema = new Schema(
    {
        kind: { type: String, enum: ADMIN_GRANT_KINDS, required: true },
        planCode: { type: String, enum: [null, ...PLAN_CODES], default: null },
        until: { type: Date, required: true },
        limits: { type: limitsSchema, default: null },
        grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', required: true },
        grantedAt: { type: Date, required: true },
    },
    { _id: false }
)

const SubscriptionSchema = new Schema<ISubscription>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
        planCode: { type: String, enum: PLAN_CODES, required: true },
        status: { type: String, enum: SUBSCRIPTION_STATUSES, required: true },
        interval: { type: String, enum: [null, ...BILLING_INTERVALS], default: null },
        trialEndsAt: { type: Date, default: null },
        currentPeriodEnd: { type: Date, default: null },
        cancelAtPeriodEnd: { type: Boolean, default: false },
        pastDueSince: { type: Date, default: null },
        dunningStage: { type: String, enum: [null, ...DUNNING_STAGES], default: null },
        lifecycleEmailStage: { type: String, enum: [null, ...LIFECYCLE_EMAIL_STAGES], default: null },
        lapsedAt: { type: Date, default: null },
        retentionStage: { type: String, enum: [null, ...RETENTION_STAGES], default: null },
        retentionStageAt: { type: Date, default: null },
        grandfatherKind: { type: String, enum: [null, ...GRANDFATHER_KINDS], default: null },
        adminGrant: { type: adminGrantSchema, default: null },
        retentionHoldUntil: { type: Date, default: null },
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
