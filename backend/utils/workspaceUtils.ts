import { Model, Types } from 'mongoose'

import Workspace, { IWorkspace, WORKSPACE_ROLES, WorkspaceRole } from '../models/Workspace'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'

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

export const loadWorkspace = async (workspaceId: string): Promise<IWorkspace> => {
    if (!Types.ObjectId.isValid(workspaceId)) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.WORKSPACE_NOT_FOUND, 404)
    }

    const workspace = await Workspace.findById(workspaceId)
    if (!workspace) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.WORKSPACE_NOT_FOUND, 404)
    }

    return workspace
}

export const assertWorkspaceMembership = async (
    workspaceId: string,
    userId: string,
    minRole: WorkspaceRole = 'viewer'
): Promise<IWorkspace> => {
    const workspace = await loadWorkspace(workspaceId)
    const role = getWorkspaceMemberRole(workspace, userId)

    if (!role || !hasMinWorkspaceRole(role, minRole)) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.NOT_A_MEMBER, 403)
    }

    return workspace
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

export const validateResourceAccess = async <
    T extends { userId: Types.ObjectId; workspaceId?: Types.ObjectId | null },
>(
    model: Model<T>,
    id: string,
    userId: string,
    notFoundMessage: string,
    minRole: WorkspaceRole = 'viewer'
): Promise<T> => {
    // SEC-60: reject a malformed id here rather than letting `findById` CastError into a 500.
    if (!Types.ObjectId.isValid(id)) {
        throw new CustomError(notFoundMessage, 404)
    }
    const resource = await model.findById(id)
    if (!resource) {
        throw new CustomError(notFoundMessage, 404)
    }

    if (resource.workspaceId) {
        await assertWorkspaceMembership(resource.workspaceId.toString(), userId, minRole)
        return resource
    }

    if (resource.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    return resource
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

export const serializeWorkspace = (workspace: IWorkspace) => {
    const doc = workspace as IWorkspace & { createdAt?: Date; updatedAt?: Date }

    return {
        _id: workspace._id,
        name: workspace.name,
        ownerId: workspace.ownerId,
        members: workspace.members.map((member) => ({
            userId: member.userId,
            role: member.role,
        })),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    }
}
