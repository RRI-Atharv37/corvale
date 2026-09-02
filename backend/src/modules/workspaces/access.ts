import { Model, Types } from 'mongoose'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    IWorkspace,
    WorkspaceRole,
    getWorkspaceMemberRole,
    hasMinWorkspaceRole,
} from '@core/access/workspace'
import Workspace from './workspace.model'

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
