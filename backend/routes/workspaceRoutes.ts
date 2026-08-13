import express from 'express'

import {
    createWorkspace,
    getWorkspaceById,
    getWorkspaces,
    inviteWorkspaceMember,
    removeWorkspaceMember,
    updateWorkspace,
    updateWorkspaceMemberRole,
} from '../controllers/workspaceController'
import { protect } from '../middleware/authMiddleware'

const router = express.Router()

router.post('/', protect, createWorkspace)
router.get('/', protect, getWorkspaces)
router.get('/:workspaceId', protect, getWorkspaceById)
router.patch('/:workspaceId', protect, updateWorkspace)
router.post('/:workspaceId/members', protect, inviteWorkspaceMember)
router.patch('/:workspaceId/members/:memberUserId', protect, updateWorkspaceMemberRole)
router.delete('/:workspaceId/members/:memberUserId', protect, removeWorkspaceMember)

export default router
