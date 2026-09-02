import WorkspaceInvite, { IWorkspaceInvite } from './workspaceInvite.model'
import { User } from '@modules/users'
import Workspace from './workspace.model'
import { Notification } from '@modules/notifications'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { createNotificationIfNew } from "@modules/notifications/notificationUtils";

export interface SerializedWorkspaceInvite {
    _id: string
    workspaceId: string
    workspaceName: string
    inviterUserId: string
    inviterName?: string
    inviterEmail?: string
    inviteeUserId: string
    inviteeEmail?: string
    role: string
    status: string
    createdAt: Date
}

export const serializeWorkspaceInvite = async (
    invite: IWorkspaceInvite
): Promise<SerializedWorkspaceInvite> => {
    const [workspace, inviter, invitee] = await Promise.all([
        Workspace.findById(invite.workspaceId).select('name'),
        User.findById(invite.inviterUserId).select('fullName email'),
        User.findById(invite.inviteeUserId).select('email'),
    ])

    return {
        _id: invite._id.toString(),
        workspaceId: invite.workspaceId.toString(),
        workspaceName: workspace?.name ?? 'Workspace',
        inviterUserId: invite.inviterUserId.toString(),
        inviterName: inviter?.fullName,
        inviterEmail: inviter?.email,
        inviteeUserId: invite.inviteeUserId.toString(),
        inviteeEmail: invitee?.email,
        role: invite.role,
        status: invite.status,
        createdAt: invite.createdAt,
    }
}

export const serializeWorkspaceInvites = async (
    invites: IWorkspaceInvite[]
): Promise<SerializedWorkspaceInvite[]> => Promise.all(invites.map(serializeWorkspaceInvite))

export const createWorkspaceInviteNotification = async (
    invite: IWorkspaceInvite,
    workspaceName: string,
    inviterName: string
): Promise<void> => {
    const roleLabel = invite.role === 'editor' ? 'an editor' : 'a viewer'

    await createNotificationIfNew({
        userId: invite.inviteeUserId.toString(),
        type: 'workspace_invite',
        title: 'Workspace invitation',
        message: `${inviterName} invited you to join "${workspaceName}" as ${roleLabel}.`,
        referenceType: 'workspace',
        referenceId: invite.workspaceId,
        dedupeKey: `workspace_invite:${invite._id.toString()}`,
        metadata: {
            inviteId: invite._id.toString(),
            workspaceId: invite.workspaceId.toString(),
            workspaceName,
            inviterName,
            role: invite.role,
        },
    })
}

export const dismissWorkspaceInviteNotification = async (
    inviteeUserId: string,
    inviteId: string
): Promise<void> => {
    await Notification.findOneAndUpdate(
        { userId: inviteeUserId, dedupeKey: `workspace_invite:${inviteId}` },
        { $set: { dismissedAt: new Date(), readAt: new Date() } }
    )
}

export const loadPendingInviteForUser = async (
    inviteId: string,
    userId: string
): Promise<IWorkspaceInvite> => {
    const invite = await WorkspaceInvite.findById(inviteId)
    if (!invite) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.INVITE_NOT_FOUND, 404)
    }

    if (invite.inviteeUserId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    if (invite.status !== 'pending') {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.INVITE_NOT_PENDING, 400)
    }

    return invite
}
