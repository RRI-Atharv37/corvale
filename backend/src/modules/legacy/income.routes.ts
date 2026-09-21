import express from 'express'
import {addIncome, getIncome, deleteIncome, downloadIncome, updateIncome, getIncomeById, filterIncomeByDate,
    //  getTotalIncome,
      searchIncome, duplicateIncome, groupIncomeByCategory} from './income.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireWriteAccess } from '@modules/billing/entitlement.middleware'
import {
    attachLegacyLedgerDeprecation,
    deprecateLegacyLedgerRoutes,
} from './deprecation.middleware'

const router = express.Router()

router.use(deprecateLegacyLedgerRoutes, attachLegacyLedgerDeprecation)

router.post('/create', protect, requireWriteAccess, addIncome)
router.get('/download', protect, downloadIncome)
router.get('/', protect, getIncome)
router.get('/filter', protect, filterIncomeByDate)
router.get('/group-by-category', protect, groupIncomeByCategory)
router.get('/search', protect, searchIncome)
router.post('/duplicate/:incomeId', protect, requireWriteAccess, duplicateIncome)
router.get('/:incomeId', protect, getIncomeById)
router.delete('/:incomeId', protect, requireWriteAccess, deleteIncome)
router.put('/:incomeId', protect, requireWriteAccess, updateIncome)

// router.get('/total', protect, getTotalIncome)

export default router