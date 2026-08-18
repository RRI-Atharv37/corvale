import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { WorkspaceRole } from './Workspace'

export const WORKSPACE_INVITE_STATUSES = ['pending', 'accepted', 'declined'] as const
export type WorkspaceInviteStatus = (typeof WORKSPACE_INVITE_STATUSES)[number]

export const WORKSPACE_INVITE_ROLES: WorkspaceRole[] = ['editor', 'viewer']

export interface IWorkspaceInvite extends Document {
    _id: Types.ObjectId
    workspaceId: Types.ObjectId
    inviteeUserId: Types.ObjectId
    inviterUserId: Types.ObjectId
    role: Exclude<WorkspaceRole, 'owner'>
    status: WorkspaceInviteStatus
    createdAt: Date
    updatedAt: Date
}

const WorkspaceInviteSchema = new Schema<IWorkspaceInvite>(
    {
        workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
        inviteeUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        inviterUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: String, enum: WORKSPACE_INVITE_ROLES, required: true },
        status: { type: String, enum: WORKSPACE_INVITE_STATUSES, default: 'pending' },
    },
    { timestamps: true }
)

WorkspaceInviteSchema.index({ inviteeUserId: 1, status: 1, createdAt: -1 })
WorkspaceInviteSchema.index(
    { workspaceId: 1, inviteeUserId: 1 },
    { unique: true, partialFilterExpression: { status: 'pending' } }
)

const WorkspaceInvite: Model<IWorkspaceInvite> = mongoose.model<IWorkspaceInvite>(
    'WorkspaceInvite',
    WorkspaceInviteSchema
)
export default WorkspaceInvite
