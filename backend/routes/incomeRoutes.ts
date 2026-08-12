import express from 'express'
import {addIncome, getIncome, deleteIncome, downloadIncome, updateIncome, getIncomeById, filterIncomeByDate,
    //  getTotalIncome,
      searchIncome, duplicateIncome, groupIncomeByCategory} from '../controllers/incomeController'
import {protect} from '../middleware/authMiddleware'

const router = express.Router()

router.post('/create', protect, addIncome)
router.get('/download', protect, downloadIncome)
router.get('/', protect, getIncome)
router.get('/filter', protect, filterIncomeByDate)
router.get('/group-by-category', protect, groupIncomeByCategory)
router.get('/search', protect, searchIncome)
router.post('/duplicate/:incomeId', protect, duplicateIncome)
router.get('/:incomeId', protect, getIncomeById)
router.delete('/:incomeId', protect, deleteIncome)
router.put('/:incomeId', protect, updateIncome)

// router.get('/total', protect, getTotalIncome)

export default router