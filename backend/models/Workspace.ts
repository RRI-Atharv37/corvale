import mongoose, { Document, Model, Schema, Types } from 'mongoose'

export const WORKSPACE_ROLES = ['owner', 'editor', 'viewer'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export interface IWorkspaceMember {
    userId: Types.ObjectId
    role: WorkspaceRole
}

export interface IWorkspace extends Document {
    _id: Types.ObjectId
    name: string
    ownerId: Types.ObjectId
    members: IWorkspaceMember[]
}

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

const Workspace: Model<IWorkspace> = mongoose.model<IWorkspace>('Workspace', workspaceSchema)
export default Workspace
