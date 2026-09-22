import mongoose, { Document, Model, Query, Schema, Types } from 'mongoose'

import { ADMIN_ROLES, type AdminRole } from './adminRoles'

export const ADMIN_AUDIT_ACTIONS = [
    'admin.login',
    'admin.login_failed',
    'admin.lockout',
    'admin.stepup_failed',
    'admin.session_revoked',
    'admin.bootstrap',
    'admin.break_glass',
    'admin.enrolled',
    'admin.invited',
    'admin.totp_reset',
    'admin.status_changed',
    'subscription.viewed',
    'grant.comp',
    'grant.plan_override',
    'grant.revoked',
    'trial.extended',
    'erasure.hold_set',
    'erasure.hold_cleared',
    'grandfather.set',
    'grandfather.revoked',
    'grandfather.bulk_applied',
    'grandfather.bulk_reverted',
] as const
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number]

export const AUDIT_ACTOR_TYPES = ['admin', 'system'] as const
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number]

export const REDACTED_REASON = '[redacted on erasure]'

export interface IAdminAuditLog extends Document {
    _id: Types.ObjectId
    adminId: Types.ObjectId | null
    adminRole: AdminRole | null
    actorType: AuditActorType
    action: AdminAuditAction
    subjectUserId: Types.ObjectId | null
    subjectSubscriptionId: Types.ObjectId | null
    targetAdminId: Types.ObjectId | null
    before: Record<string, unknown> | null
    after: Record<string, unknown> | null
    amountMinor: number | null
    currency: string | null
    reason: string | null
    requestId: string | null
    ip: string | null
    at: Date
    expireAt: Date | null
}

const APPEND_ONLY_UPDATE = 'AdminAuditLog is append-only: recorded fields cannot be rewritten'
const APPEND_ONLY_DELETE = 'AdminAuditLog is append-only: deletes are refused'

const AdminAuditLogSchema = new Schema<IAdminAuditLog>(
    {
        adminId: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
        adminRole: { type: String, enum: [null, ...ADMIN_ROLES], default: null, immutable: true },
        actorType: { type: String, enum: AUDIT_ACTOR_TYPES, default: 'admin', immutable: true },
        action: { type: String, enum: ADMIN_AUDIT_ACTIONS, required: true, immutable: true },
        subjectUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
        subjectSubscriptionId: { type: mongoose.Schema.Types.ObjectId, default: null },
        targetAdminId: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
        before: { type: Schema.Types.Mixed, default: null, immutable: true },
        after: { type: Schema.Types.Mixed, default: null, immutable: true },
        amountMinor: { type: Number, default: null, immutable: true },
        currency: { type: String, default: null, immutable: true },
        reason: { type: String, default: null },
        requestId: { type: String, default: null, immutable: true },
        ip: { type: String, default: null },
        at: { type: Date, default: Date.now, immutable: true },
        expireAt: { type: Date, default: null, immutable: true },
    },
    { timestamps: false, minimize: false }
)

AdminAuditLogSchema.index({ at: -1 })
AdminAuditLogSchema.index({ adminId: 1, at: -1 })
AdminAuditLogSchema.index({ action: 1, at: -1 })
AdminAuditLogSchema.index({ subjectUserId: 1, at: -1 })
AdminAuditLogSchema.index({ subjectSubscriptionId: 1 }, { sparse: true })
AdminAuditLogSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

/**
 * The two sanctioned exceptions to append-only, each passed only by its own function in
 * `adminAudit.service.ts` and each shape-checked here so nothing else can ride along:
 * erasure severs the row from its subject (D5); the retention sweep removes a stale `ip`.
 */
export const AUDIT_ERASURE_REDACTION = Symbol('adminAuditErasureRedaction')
export const AUDIT_IP_SCRUB = Symbol('adminAuditIpScrub')

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const isErasureUpdate = (update: unknown): boolean => {
    if (!isPlainObject(update)) return false
    const { $set, ...rest } = update
    if (Object.keys(rest).length > 0 || !isPlainObject($set)) return false

    return (
        Object.keys($set).length === 3 &&
        $set.subjectUserId === null &&
        $set.subjectSubscriptionId === null &&
        $set.reason === REDACTED_REASON
    )
}

const isIpScrubUpdate = (update: unknown): boolean => {
    if (!isPlainObject(update)) return false
    const { $unset, ...rest } = update
    if (Object.keys(rest).length > 0 || !isPlainObject($unset)) return false

    const keys = Object.keys($unset)
    return keys.length === 1 && keys[0] === 'ip'
}

const refuseRewrite = function (this: Query<unknown, unknown>, next: (err?: Error) => void) {
    const options = this.getOptions() as Record<symbol, unknown>
    const update = this.getUpdate()

    if (options[AUDIT_ERASURE_REDACTION] === true && isErasureUpdate(update)) return next()
    if (options[AUDIT_IP_SCRUB] === true && isIpScrubUpdate(update)) return next()
    return next(new Error(APPEND_ONLY_UPDATE))
}

for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate'] as const) {
    AdminAuditLogSchema.pre(operation, refuseRewrite)
}

for (const operation of ['replaceOne', 'findOneAndReplace'] as const) {
    AdminAuditLogSchema.pre(operation, (next) => next(new Error(APPEND_ONLY_UPDATE)))
}

for (const operation of ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
    AdminAuditLogSchema.pre(operation, (next) => next(new Error(APPEND_ONLY_DELETE)))
}
AdminAuditLogSchema.pre('deleteOne', { document: true, query: false }, (next) => next(new Error(APPEND_ONLY_DELETE)))

// System collection: no userId, so the row-level-security plugin does not apply (same as BillingEvent).
const AdminAuditLog: Model<IAdminAuditLog> = mongoose.model<IAdminAuditLog>('AdminAuditLog', AdminAuditLogSchema)
export default AdminAuditLog
