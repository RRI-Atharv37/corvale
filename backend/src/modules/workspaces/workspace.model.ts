import mongoose, { Model, Schema } from 'mongoose'

import {
    IWorkspace,
    IWorkspaceMember,
    WORKSPACE_ROLES,
    WorkspaceRole,
} from '@core/access/workspace'

export type { IWorkspace, IWorkspaceMember, WorkspaceRole }
export { WORKSPACE_ROLES }

const workspaceMemberSchema = new Schema<IWorkspaceMember>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: String, enum: WORKSPACE_ROLES, required: true },
    },
    { _id: false }
)

const workspaceSchema = new Schema<IWorkspace>(
    {
        name: { type: String, required: true, trim: true },
        ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        members: { type: [workspaceMemberSchema], default: [] },
    },
    { timestamps: true }
)

workspaceSchema.index({ ownerId: 1 })
workspaceSchema.index({ 'members.userId': 1 })

// No row-level-security plugin (SEC-30): a Workspace has no `userId` field. Access is
// membership-scoped via `ownerId` / `members.userId`, which the plugin's `'userId' in filter`
// guard cannot express; `utils/workspaceUtils.ts` (`assertWorkspaceMembership`) enforces it.

const Workspace: Model<IWorkspace> = mongoose.model<IWorkspace>('Workspace', workspaceSchema)
export default Workspace
