import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '../utils/applyRowLevelSecurity'
import { applySoftDelete } from '../utils/applySoftDelete'

export const NOTIFICATION_TYPES = [
    'budget_over_limit',
    'bill_due',
    'savings_milestone',
    'workspace_invite',
    'workspace_member_left',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const NOTIFICATION_REFERENCE_TYPES = [
    'budget',
    'recurring_rule',
    'savings_goal',
    'workspace',
] as const
export type NotificationReferenceType = (typeof NOTIFICATION_REFERENCE_TYPES)[number]

export interface INotification extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    type: NotificationType
    title: string
    message: string
    referenceType?: NotificationReferenceType
    referenceId?: Types.ObjectId
    dedupeKey: string
    readAt?: Date | null
    dismissedAt?: Date | null
    metadata?: Record<string, unknown>
    deletedAt?: Date | null
    createdAt: Date
    updatedAt: Date
}

const NotificationSchema = new Schema<INotification>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        type: { type: String, enum: NOTIFICATION_TYPES, required: true },
        title: { type: String, required: true, trim: true },
        message: { type: String, required: true, trim: true },
        referenceType: { type: String, enum: NOTIFICATION_REFERENCE_TYPES },
        referenceId: { type: mongoose.Schema.Types.ObjectId },
        dedupeKey: { type: String, required: true, trim: true },
        readAt: { type: Date, default: null },
        dismissedAt: { type: Date, default: null },
        metadata: { type: Schema.Types.Mixed },
    },
    { timestamps: true }
)

NotificationSchema.index(
    { userId: 1, dedupeKey: 1 },
    { unique: true, partialFilterExpression: { deletedAt: null } }
)
NotificationSchema.index({ userId: 1, dismissedAt: 1, createdAt: -1 })
NotificationSchema.index({ userId: 1, readAt: 1 })
NotificationSchema.index({ userId: 1, updatedAt: 1, _id: 1 })

applyRowLevelSecurity(NotificationSchema)
applySoftDelete(NotificationSchema)

const Notification: Model<INotification> = mongoose.model<INotification>(
    'Notification',
    NotificationSchema
)
export default Notification
