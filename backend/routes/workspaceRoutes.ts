import express from 'express'

import {
    acceptWorkspaceInvite,
    createWorkspace,
    declineWorkspaceInvite,
    getReceivedWorkspaceInvites,
    getWorkspaceById,
    getWorkspacePendingInvites,
    getWorkspaces,
    inviteWorkspaceMember,
    removeWorkspaceMember,
    updateWorkspace,
    updateWorkspaceMemberRole,
} from '../controllers/workspaceController'
import { protect } from '@http/middleware/authMiddleware'
import { createWorkspaceInviteRateLimiter } from '@http/middleware/rateLimitMiddleware'

export const createWorkspaceRoutes = (): express.Router => {
    const router = express.Router()
    // SEC-32: the invite endpoint discloses whether an email has an account (404 on no match);
    // its own budget, separate from the global mutating limiter and from login.
    const inviteRateLimiter = createWorkspaceInviteRateLimiter()

    router.get('/invites/received', protect, getReceivedWorkspaceInvites)
    router.post('/invites/:inviteId/accept', protect, acceptWorkspaceInvite)
    router.post('/invites/:inviteId/decline', protect, declineWorkspaceInvite)
    router.post('/', protect, createWorkspace)
    router.get('/', protect, getWorkspaces)
    router.get('/:workspaceId', protect, getWorkspaceById)
    router.patch('/:workspaceId', protect, updateWorkspace)
    router.get('/:workspaceId/invites', protect, getWorkspacePendingInvites)
    router.post('/:workspaceId/members', protect, inviteRateLimiter, inviteWorkspaceMember)
    router.patch('/:workspaceId/members/:memberUserId', protect, updateWorkspaceMemberRole)
    router.delete('/:workspaceId/members/:memberUserId', protect, removeWorkspaceMember)

    return router
}

export default createWorkspaceRoutes()
