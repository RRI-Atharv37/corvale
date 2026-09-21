import express from 'express'

import {
    archiveCategory,
    createCategory,
    getCategories,
    getCategoryById,
    reorderCategories,
    updateCategory,
} from './category.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireWriteAccess } from '@modules/billing/entitlement.middleware'

const router = express.Router()

router.post('/', protect, requireWriteAccess, createCategory)
router.get('/', protect, getCategories)
router.put('/reorder', protect, requireWriteAccess, reorderCategories)
router.get('/:categoryId', protect, getCategoryById)
router.put('/:categoryId', protect, requireWriteAccess, updateCategory)
router.delete('/:categoryId', protect, requireWriteAccess, archiveCategory)

export default router
