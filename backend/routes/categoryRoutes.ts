import express from 'express'

import {
    archiveCategory,
    createCategory,
    getCategories,
    getCategoryById,
    reorderCategories,
    updateCategory,
} from '../controllers/categoryController'
import { protect } from '../middleware/authMiddleware'

const router = express.Router()

router.post('/', protect, createCategory)
router.get('/', protect, getCategories)
router.put('/reorder', protect, reorderCategories)
router.get('/:categoryId', protect, getCategoryById)
router.put('/:categoryId', protect, updateCategory)
router.delete('/:categoryId', protect, archiveCategory)

export default router
