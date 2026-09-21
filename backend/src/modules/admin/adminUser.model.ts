import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { EMAIL_REGEX } from '@infra/mail/emailUtils'

import { ADMIN_ROLES, ADMIN_STATUSES, type AdminRole, type AdminStatus } from './adminRoles'

export interface IAdminUser extends Document {
    _id: Types.ObjectId
    email: string
    role: AdminRole
    status: AdminStatus
    passwordHash: string | null
    totpSecretEnc: string | null
    pendingTotpSecretEnc: string | null
    totpLastStep: number | null
    recoveryCodeHashes: string[]
    failedLoginCount: number
    lockedUntil: Date | null
    moneyBlockedUntil: Date | null
    enrolmentTokenHash: string | null
    enrolmentExpiresAt: Date | null
    invitedBy: Types.ObjectId | null
    lastLoginAt: Date | null
    createdAt: Date
    updatedAt: Date
}

/**
 * Staff, not customers: never a `User`, so no customer account can become an admin through any
 * user-path bug. No `userId`, so the row-level-security plugin does not apply (same as `BillingEvent`).
 */
const AdminUserSchema = new Schema<IAdminUser>(
    {
        email: { type: String, required: true, unique: true, lowercase: true, trim: true, match: EMAIL_REGEX },
        role: { type: String, enum: ADMIN_ROLES, required: true },
        status: { type: String, enum: ADMIN_STATUSES, required: true, default: 'pending' },
        passwordHash: { type: String, default: null },
        totpSecretEnc: { type: String, default: null },
        pendingTotpSecretEnc: { type: String, default: null },
        totpLastStep: { type: Number, default: null },
        recoveryCodeHashes: { type: [String], default: [] },
        failedLoginCount: { type: Number, default: 0 },
        lockedUntil: { type: Date, default: null },
        moneyBlockedUntil: { type: Date, default: null },
        enrolmentTokenHash: { type: String, default: null },
        enrolmentExpiresAt: { type: Date, default: null },
        invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
        lastLoginAt: { type: Date, default: null },
    },
    { timestamps: true }
)

AdminUserSchema.index({ enrolmentTokenHash: 1 }, { unique: true, partialFilterExpression: { enrolmentTokenHash: { $type: 'string' } } })

const AdminUser: Model<IAdminUser> = mongoose.model<IAdminUser>('AdminUser', AdminUserSchema)
export default AdminUser
