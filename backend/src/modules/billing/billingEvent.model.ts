import mongoose, { Document, Model, Query, Schema, Types } from 'mongoose'

export interface IBillingEvent extends Document {
    _id: Types.ObjectId
    providerEventId: string
    type: string
    occurredAt: Date
    payload: Record<string, unknown>
    processedAt: Date | null
    error: string | null
    redactedAt: Date | null
    /** Set once, atomically, the first time this event's counters are recorded - a redelivery cannot double-count (M7b). */
    metricsRecordedAt: Date | null
    /** Set once, atomically, the first time this event was considered for deferred-revenue recognition (M8e) - same claim-once shape as `metricsRecordedAt`. */
    revenueRecognizedAt: Date | null
    createdAt: Date
    updatedAt: Date
}

const IMMUTABLE_PATHS = ['providerEventId', 'type', 'occurredAt', 'payload'] as const

const APPEND_ONLY_DELETE = 'BillingEvent is append-only: deletes are refused'
const APPEND_ONLY_UPDATE = 'BillingEvent is append-only: recorded fields cannot be rewritten'

const BillingEventSchema = new Schema<IBillingEvent>(
    {
        providerEventId: { type: String, required: true, unique: true, immutable: true },
        type: { type: String, required: true, immutable: true },
        occurredAt: { type: Date, required: true, immutable: true },
        payload: { type: Schema.Types.Mixed, default: {}, immutable: true },
        processedAt: { type: Date, default: null },
        error: { type: String, default: null },
        redactedAt: { type: Date, default: null },
        metricsRecordedAt: { type: Date, default: null },
        revenueRecognizedAt: { type: Date, default: null },
    },
    { timestamps: true, minimize: false }
)

// The admin subscriber view reads a subscriber's ledger by the provider ids in the payload.
BillingEventSchema.index({ 'payload.providerSubscriptionId': 1, occurredAt: -1 }, { sparse: true })
BillingEventSchema.index({ 'payload.providerCustomerId': 1, occurredAt: -1 }, { sparse: true })
BillingEventSchema.index({ processedAt: 1, error: 1 })
// The M8e recognition sweep scans exactly this shape: unrecognized payment events.
BillingEventSchema.index({ type: 1, revenueRecognizedAt: 1 })

const touchesImmutablePath = (update: unknown): boolean => {
    if (!update || typeof update !== 'object') return false

    const paths: string[] = []
    for (const [key, value] of Object.entries(update as Record<string, unknown>)) {
        if (key.startsWith('$') && value && typeof value === 'object' && !Array.isArray(value)) {
            paths.push(...Object.keys(value))
        } else if (!key.startsWith('$')) {
            paths.push(key)
        }
    }

    return paths.some((path) =>
        IMMUTABLE_PATHS.some((immutable) => path === immutable || path.startsWith(`${immutable}.`))
    )
}

/**
 * The one sanctioned exception to append-only: provider ids identify a person at the Merchant of
 * Record, so erasure must be able to remove exactly those two fields. Only `redactLedgerProviderIds`
 * passes this option, and the update shape is checked so nothing else can ride along with it.
 */
export const BILLING_EVENT_REDACTION = Symbol('billingEventRedaction')

const REDACTABLE_PATHS = ['payload.providerCustomerId', 'payload.providerSubscriptionId']

const isRedactionUpdate = (update: unknown): boolean => {
    if (!update || typeof update !== 'object') return false
    const { $unset, $set, ...rest } = update as { $unset?: Record<string, unknown>; $set?: Record<string, unknown> }
    if (Object.keys(rest).length > 0) return false
    return (
        Object.keys($unset ?? {}).every((path) => REDACTABLE_PATHS.includes(path)) &&
        Object.keys($set ?? {}).every((path) => path === 'redactedAt')
    )
}

const refuseRewrite = function (this: Query<unknown, unknown>, next: (err?: Error) => void) {
    const update = this.getUpdate()
    if (!touchesImmutablePath(update)) return next()
    const sanctioned = (this.getOptions() as Record<symbol, unknown>)[BILLING_EVENT_REDACTION] === true
    return sanctioned && isRedactionUpdate(update) ? next() : next(new Error(APPEND_ONLY_UPDATE))
}

for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate'] as const) {
    BillingEventSchema.pre(operation, refuseRewrite)
}

for (const operation of ['replaceOne', 'findOneAndReplace'] as const) {
    BillingEventSchema.pre(operation, (next) => next(new Error(APPEND_ONLY_UPDATE)))
}

for (const operation of ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
    BillingEventSchema.pre(operation, (next) => next(new Error(APPEND_ONLY_DELETE)))
}
BillingEventSchema.pre('deleteOne', { document: true, query: false }, (next) =>
    next(new Error(APPEND_ONLY_DELETE))
)

// System collection: rows carry no userId, so the row-level-security plugin is not applied. The
// webhook handler is the only writer and runs outside any request RLS context.
const BillingEvent: Model<IBillingEvent> = mongoose.model<IBillingEvent>('BillingEvent', BillingEventSchema)
export default BillingEvent
