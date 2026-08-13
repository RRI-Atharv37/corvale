import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import Workspace, { WORKSPACE_ROLES, WorkspaceRole } from '../models/Workspace'
import User from '../models/User'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import {
    assertWorkspaceMembership,
    findWorkspaceMember,
    getWorkspaceMemberRole,
    isWorkspaceRole,
    loadWorkspace,
    serializeWorkspace,
} from '../utils/workspaceUtils'
import { getUserId, handleResponses, validateRequiredFields } from '../utils/sharedUtils'

const INVITE_ROLES: WorkspaceRole[] = ['editor', 'viewer']

const serializeWorkspaceWithUsers = async (workspace: Awaited<ReturnType<typeof loadWorkspace>>) => {
    const userIds = workspace.members.map((member) => member.userId)
    const users = await User.find({ _id: { $in: userIds } }).select('fullName email')
    const userMap = new Map(users.map((user) => [user._id.toString(), user]))

    return {
        ...serializeWorkspace(workspace),
        members: workspace.members.map((member) => {
            const user = userMap.get(member.userId.toString())
            return {
                userId: member.userId,
                role: member.role,
                fullName: user?.fullName,
                email: user?.email,
            }
        }),
    }
}

export const createWorkspace = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    validateRequiredFields(req.body, ['name'])

    const name = String(req.body.name).trim()
    if (!name) {
        throw new CustomError('Workspace name cannot be empty', 400)
    }

    const workspace = await Workspace.create({
        name,
        ownerId: userId,
        members: [{ userId, role: 'owner' }],
    })

    const serialized = await serializeWorkspaceWithUsers(workspace)
    handleResponses(res, 201, serialized)
})

export const getWorkspaces = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const workspaces = await Workspace.find({ 'members.userId': userId }).sort({ updatedAt: -1 })
    const serialized = await Promise.all(workspaces.map((workspace) => serializeWorkspaceWithUsers(workspace)))

    handleResponses(res, 200, serialized)
})

export const getWorkspaceById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { workspaceId } = req.params

    validateRequiredFields({ workspaceId }, ['workspaceId'])

    await assertWorkspaceMembership(workspaceId, userId, 'viewer')
    const workspace = await loadWorkspace(workspaceId)
    const serialized = await serializeWorkspaceWithUsers(workspace)

    handleResponses(res, 200, serialized)
})

export const updateWorkspace = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { workspaceId } = req.params

    validateRequiredFields({ workspaceId }, ['workspaceId'])

    const workspace = await assertWorkspaceMembership(workspaceId, userId, 'owner')

    if (req.body.name !== undefined) {
        const name = String(req.body.name).trim()
        if (!name) {
            throw new CustomError('Workspace name cannot be empty', 400)
        }
        workspace.name = name
    }

    const updated = await workspace.save()
    const serialized = await serializeWorkspaceWithUsers(updated)
    handleResponses(res, 200, serialized)
})

export const inviteWorkspaceMember = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { workspaceId } = req.params

    validateRequiredFields({ workspaceId }, ['workspaceId'])
    validateRequiredFields(req.body, ['email', 'role'])

    const workspace = await assertWorkspaceMembership(workspaceId, userId, 'owner')

    const email = String(req.body.email).trim().toLowerCase()
    const role = req.body.role as WorkspaceRole

    if (!isWorkspaceRole(role) || !INVITE_ROLES.includes(role)) {
        throw new CustomError(
            `Invalid role. Must be one of: ${INVITE_ROLES.join(', ')}`,
            400
        )
    }

    const invitee = await User.findOne({ email })
    if (!invitee) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.USER_NOT_FOUND, 404)
    }

    if (findWorkspaceMember(workspace, invitee._id.toString())) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.MEMBER_ALREADY_EXISTS, 400)
    }

    workspace.members.push({ userId: invitee._id, role })
    const updated = await workspace.save()
    const serialized = await serializeWorkspaceWithUsers(updated)

    handleResponses(res, 201, serialized)
})

export const updateWorkspaceMemberRole = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { workspaceId, memberUserId } = req.params

    validateRequiredFields({ workspaceId, memberUserId }, ['workspaceId', 'memberUserId'])
    validateRequiredFields(req.body, ['role'])

    const workspace = await assertWorkspaceMembership(workspaceId, userId, 'owner')
    const role = req.body.role as WorkspaceRole

    if (!isWorkspaceRole(role) || !INVITE_ROLES.includes(role)) {
        throw new CustomError(
            `Invalid role. Must be one of: ${INVITE_ROLES.join(', ')}`,
            400
        )
    }

    const member = findWorkspaceMember(workspace, memberUserId)
    if (!member) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.MEMBER_NOT_FOUND, 404)
    }

    if (member.role === 'owner') {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.CANNOT_CHANGE_OWNER_ROLE, 400)
    }

    member.role = role
    const updated = await workspace.save()
    const serialized = await serializeWorkspaceWithUsers(updated)

    handleResponses(res, 200, serialized)
})

export const removeWorkspaceMember = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { workspaceId, memberUserId } = req.params

    validateRequiredFields({ workspaceId, memberUserId }, ['workspaceId', 'memberUserId'])

    const workspace = await loadWorkspace(workspaceId)
    const actorRole = getWorkspaceMemberRole(workspace, userId)
    const isSelfRemoval = memberUserId === userId

    if (!actorRole) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.NOT_A_MEMBER, 403)
    }

    if (isSelfRemoval) {
        if (actorRole === 'owner') {
            throw new CustomError(ERROR_MESSAGES.WORKSPACE.OWNER_CANNOT_LEAVE, 400)
        }
    } else if (actorRole !== 'owner') {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.NOT_A_MEMBER, 403)
    }

    const member = findWorkspaceMember(workspace, memberUserId)
    if (!member) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.MEMBER_NOT_FOUND, 404)
    }

    if (member.role === 'owner') {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.CANNOT_REMOVE_OWNER, 400)
    }

    workspace.members = workspace.members.filter(
        (entry) => entry.userId.toString() !== memberUserId
    )

    const updated = await workspace.save()
    const serialized = await serializeWorkspaceWithUsers(updated)

    handleResponses(res, 200, serialized)
})
