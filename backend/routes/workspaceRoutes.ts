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
import { protect } from '../middleware/authMiddleware'

const router = express.Router()

router.get('/invites/received', protect, getReceivedWorkspaceInvites)
router.post('/invites/:inviteId/accept', protect, acceptWorkspaceInvite)
router.post('/invites/:inviteId/decline', protect, declineWorkspaceInvite)
router.post('/', protect, createWorkspace)
router.get('/', protect, getWorkspaces)
router.get('/:workspaceId', protect, getWorkspaceById)
router.patch('/:workspaceId', protect, updateWorkspace)
router.get('/:workspaceId/invites', protect, getWorkspacePendingInvites)
router.post('/:workspaceId/members', protect, inviteWorkspaceMember)
router.patch('/:workspaceId/members/:memberUserId', protect, updateWorkspaceMemberRole)
router.delete('/:workspaceId/members/:memberUserId', protect, removeWorkspaceMember)

export default router
