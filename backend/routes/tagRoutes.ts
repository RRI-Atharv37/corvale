import express from 'express'

import {
    createTag,
    dedupeTags,
    deleteTag,
    getTagById,
    getTags,
    updateTag,
} from '../controllers/tagController'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.post('/dedupe', protect, dedupeTags)
router.post('/', protect, createTag)
router.get('/', protect, getTags)
router.get('/:tagId', protect, getTagById)
router.put('/:tagId', protect, updateTag)
router.delete('/:tagId', protect, deleteTag)

export default router
