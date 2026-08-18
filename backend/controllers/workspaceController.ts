import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import Workspace, { WORKSPACE_ROLES, WorkspaceRole } from '../models/Workspace'
import WorkspaceInvite from '../models/WorkspaceInvite'
import User from '../models/User'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import {
    createWorkspaceInviteNotification,
    dismissWorkspaceInviteNotification,
    loadPendingInviteForUser,
    serializeWorkspaceInvite,
    serializeWorkspaceInvites,
} from '../utils/workspaceInviteUtils'
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

    if (invitee._id.toString() === userId) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.CANNOT_INVITE_SELF, 400)
    }

    if (findWorkspaceMember(workspace, invitee._id.toString())) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.MEMBER_ALREADY_EXISTS, 400)
    }

    const existingInvite = await WorkspaceInvite.findOne({
        workspaceId,
        inviteeUserId: invitee._id,
        status: 'pending',
    })
    if (existingInvite) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.INVITE_ALREADY_PENDING, 400)
    }

    const inviter = await User.findById(userId).select('fullName')

    const invite = await WorkspaceInvite.create({
        workspaceId,
        inviteeUserId: invitee._id,
        inviterUserId: userId,
        role,
        status: 'pending',
    })

    await createWorkspaceInviteNotification(
        invite,
        workspace.name,
        inviter?.fullName?.trim() || 'Someone'
    )

    const serialized = await serializeWorkspaceInvite(invite)
    handleResponses(res, 201, serialized)
})

export const getReceivedWorkspaceInvites = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const invites = await WorkspaceInvite.find({
        inviteeUserId: userId,
        status: 'pending',
    }).sort({ createdAt: -1 })

    const serialized = await serializeWorkspaceInvites(invites)
    handleResponses(res, 200, serialized)
})

export const getWorkspacePendingInvites = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { workspaceId } = req.params

    validateRequiredFields({ workspaceId }, ['workspaceId'])

    await assertWorkspaceMembership(workspaceId, userId, 'owner')

    const invites = await WorkspaceInvite.find({
        workspaceId,
        status: 'pending',
    }).sort({ createdAt: -1 })

    const serialized = await serializeWorkspaceInvites(invites)
    handleResponses(res, 200, serialized)
})

export const acceptWorkspaceInvite = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { inviteId } = req.params

    validateRequiredFields({ inviteId }, ['inviteId'])

    const invite = await loadPendingInviteForUser(inviteId, userId)
    const workspace = await loadWorkspace(invite.workspaceId.toString())

    if (findWorkspaceMember(workspace, userId)) {
        invite.status = 'accepted'
        await invite.save()
        await dismissWorkspaceInviteNotification(userId, inviteId)
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.MEMBER_ALREADY_EXISTS, 400)
    }

    workspace.members.push({ userId: invite.inviteeUserId, role: invite.role })
    await workspace.save()

    invite.status = 'accepted'
    await invite.save()
    await dismissWorkspaceInviteNotification(userId, inviteId)

    const serialized = await serializeWorkspaceWithUsers(workspace)
    handleResponses(res, 200, serialized)
})

export const declineWorkspaceInvite = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { inviteId } = req.params

    validateRequiredFields({ inviteId }, ['inviteId'])

    const invite = await loadPendingInviteForUser(inviteId, userId)

    invite.status = 'declined'
    await invite.save()
    await dismissWorkspaceInviteNotification(userId, inviteId)

    handleResponses(res, 200, { message: 'Invitation declined' })
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
