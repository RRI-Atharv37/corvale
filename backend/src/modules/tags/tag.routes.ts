import express from 'express'

import {
    createTag,
    dedupeTags,
    deleteTag,
    getTagById,
    getTags,
    updateTag,
} from './tag.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireWriteAccess } from '@modules/billing/entitlement.middleware'

const router = express.Router()

router.post('/dedupe', protect, requireWriteAccess, dedupeTags)
router.post('/', protect, requireWriteAccess, createTag)
router.get('/', protect, getTags)
router.get('/:tagId', protect, getTagById)
router.put('/:tagId', protect, requireWriteAccess, updateTag)
router.delete('/:tagId', protect, requireWriteAccess, deleteTag)

export default router
