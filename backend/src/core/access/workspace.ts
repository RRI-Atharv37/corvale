import { Document, Types } from 'mongoose'

import { CustomError } from '../errors/customError'
import { ERROR_MESSAGES } from '../errors/errorMessages'

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

const ROLE_RANK: Record<WorkspaceRole, number> = {
    viewer: 1,
    editor: 2,
    owner: 3,
}

export const isWorkspaceRole = (value: unknown): value is WorkspaceRole => {
    return typeof value === 'string' && WORKSPACE_ROLES.includes(value as WorkspaceRole)
}

export const hasMinWorkspaceRole = (role: WorkspaceRole, minRole: WorkspaceRole): boolean => {
    return ROLE_RANK[role] >= ROLE_RANK[minRole]
}

export const findWorkspaceMember = (
    workspace: IWorkspace,
    userId: string
): IWorkspace['members'][number] | undefined => {
    return workspace.members.find((member) => member.userId.toString() === userId)
}

export const getWorkspaceMemberRole = (
    workspace: IWorkspace,
    userId: string
): WorkspaceRole | null => {
    const member = findWorkspaceMember(workspace, userId)
    return member?.role ?? null
}

export const parseOptionalWorkspaceId = (value: unknown): string | null | undefined => {
    if (value === undefined) {
        return undefined
    }
    if (value === null || value === '') {
        return null
    }
    if (typeof value !== 'string') {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.INVALID_WORKSPACE_ID, 400)
    }
    if (!Types.ObjectId.isValid(value)) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.INVALID_WORKSPACE_ID, 400)
    }
    return value
}

export const buildScopedListFilter = (
    userId: string,
    workspaceId?: string | null
): Record<string, unknown> => {
    if (workspaceId) {
        return { workspaceId: new Types.ObjectId(workspaceId) }
    }

    return {
        userId: new Types.ObjectId(userId),
        workspaceId: null,
    }
}

export const assertAccountMatchesWorkspace = (
    accountWorkspaceId: Types.ObjectId | null | undefined,
    workspaceId: string | null | undefined
): void => {
    const accountWs = accountWorkspaceId?.toString() ?? null
    const targetWs = workspaceId ?? null

    if (accountWs !== targetWs) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.ACCOUNT_WORKSPACE_MISMATCH, 400)
    }
}
