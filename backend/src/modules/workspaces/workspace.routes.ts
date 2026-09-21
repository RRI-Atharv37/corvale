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
} from './workspace.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireEntitlement, requireScopedWriteAccess } from '@modules/billing/entitlement.middleware'
import { scopeFromParam } from '@modules/billing/billingScope'
import { createWorkspaceInviteRateLimiter } from '@http/middleware/rateLimitMiddleware'

export const createWorkspaceRoutes = (): express.Router => {
    const router = express.Router()
    // SEC-32: the invite endpoint discloses whether an email has an account (404 on no match);
    // its own budget, separate from the global mutating limiter and from login.
    const inviteRateLimiter = createWorkspaceInviteRateLimiter()
    // Leaving or removing a member is deliberately ungated: it only frees seats, and a member
    // must be able to leave a workspace whose owner has lapsed.
    const inThisWorkspace = requireScopedWriteAccess(scopeFromParam())

    router.get('/invites/received', protect, getReceivedWorkspaceInvites)
    router.post('/invites/:inviteId/accept', protect, acceptWorkspaceInvite)
    router.post('/invites/:inviteId/decline', protect, declineWorkspaceInvite)
    router.post('/', protect, requireEntitlement('workspaces'), createWorkspace)
    router.get('/', protect, getWorkspaces)
    router.get('/:workspaceId', protect, getWorkspaceById)
    router.patch('/:workspaceId', protect, inThisWorkspace, updateWorkspace)
    router.get('/:workspaceId/invites', protect, getWorkspacePendingInvites)
    router.post('/:workspaceId/members', protect, inThisWorkspace, inviteRateLimiter, inviteWorkspaceMember)
    router.patch('/:workspaceId/members/:memberUserId', protect, inThisWorkspace, updateWorkspaceMemberRole)
    router.delete('/:workspaceId/members/:memberUserId', protect, removeWorkspaceMember)

    return router
}

export default createWorkspaceRoutes()
