export type WorkspaceRole = 'owner' | 'editor' | 'viewer'

export type WorkspaceInviteRole = 'editor' | 'viewer'

export interface WorkspaceMember {
    userId: string
    role: WorkspaceRole
    fullName?: string
    email?: string
}

export interface Workspace {
    _id: string
    name: string
    ownerId: string
    members: WorkspaceMember[]
    createdAt?: string
    updatedAt?: string
}

export interface WorkspaceFormData {
    name: string
}

export interface WorkspaceInviteFormData {
    email: string
    role: WorkspaceInviteRole
}

export interface WorkspaceInvite {
    _id: string
    workspaceId: string
    workspaceName: string
    inviterUserId: string
    inviterName?: string
    inviterEmail?: string
    inviteeUserId: string
    inviteeEmail?: string
    role: WorkspaceInviteRole
    status: 'pending' | 'accepted' | 'declined'
    createdAt: string
}
