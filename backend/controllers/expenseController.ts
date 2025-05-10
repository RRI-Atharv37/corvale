import asyncHandler from 'express-async-handler'
import {Request, Response} from 'express'

import Expense from '../models/Expense'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { aggregateExpenses, getUserId, handleReponses, validateOwnership, validateRequiredFields } from '../utils/expenseUtils'

interface AuthRequest extends Request {
    user?: { id: string }
}

export const addExpense = asyncHandler(async(req: Request, res: Response) => {
        const userId = getUserId(req as AuthRequest)
        validateRequiredFields(req.body, ['userId', 'title', 'amount', 'category', 'date'])

        const { title, amount, source, description, category, date, paymentMethod, recurring, tags } = req.body
    
        if (isNaN(amount) || isNaN(Date.parse(date))) {
            throw new CustomError('Invalid amount or date format', 400)
        }
    
        const newExpense = await Expense.create({
            userId,
            title,
            amount,
            source,
            description,
            category,
            date: new Date(date),
            paymentMethod,
            recurring,
            tags,
        })
    
        handleReponses(res, 201, newExpense)
})

export const getExpense = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    const { page = 1, limit = 10 } = req.query

    const pageNumber = Number(page)
    const limitNumber = Number(limit)

    if(isNaN(pageNumber) || isNaN(limitNumber) || pageNumber < 1 || limitNumber < 1) {
        throw new CustomError('Invalid page or limit number', 400)
    }

    const incomes = await Expense.find({userId})
        .sort({date: -1})
        .skip((pageNumber - 1) * limitNumber)
        .limit(limitNumber)

    const totalExpenses = await Expense.countDocuments({userId})
    const totalPages = Math.ceil(totalExpenses / limitNumber)

    handleReponses(res, 200, {
        data: incomes,
        meta: {
            totalExpenses,
            pageNumber,
            totalPages: totalPages,
            limit: limitNumber,
        }
    })
})

export const getExpenseById = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    const { expenseId } = req.params

    validateRequiredFields({expenseId}, ['expenseId'])

    const expense = await validateOwnership(Expense, expenseId, userId)

    handleReponses(res, 200, expense)
})

export const updateExpense = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    const { expenseId } = req.params
    const { title, amount, description, category, date, paymentMethod, recurring, tags } = req.body

    const expense = await validateOwnership(Expense, expenseId, userId)

    expense.title = title || expense.title
    expense.amount = amount || expense.amount
    expense.description = description || expense.description
    expense.category = category || expense.category
    expense.date = date ? new Date(date) : expense.date
    expense.paymentMethod = paymentMethod || expense.paymentMethod
    expense.recurring = recurring || expense.recurring
    expense.tags = tags || expense.tags

    await expense.save()
    handleReponses(res, 200, expense)
})

export const deleteExpense = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    const { expenseId } = req.params

    validateRequiredFields({expenseId}, ['expenseId'])

    await validateOwnership(Expense, expenseId, userId)

    await Expense.deleteOne({ _id: expenseId })
    
    handleReponses(res, 200, {message: 'Expense deleted successfully'})
})

export const filterExpense = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    const { startDate, endDate, } = req.query

    validateRequiredFields({startDate, endDate}, ['startDate', 'endDate'])

    const expenses = await Expense.find({
        userId,
        date: {
            $gte: new Date(startDate as string),
            $lte: new Date(endDate as string),
        }
    }).sort({ date: -1 })

    if(!expenses || expenses.length === 0) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND, 404)
    }

    handleReponses(res, 200, expenses)

})

export const searchExpense = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    const { keyword } = req.query

    if(!userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    validateRequiredFields({keyword}, ['keyword'])

    const expenses = await Expense.find({
        userId,
        $or: [
            { title: { $regex: keyword, $options: 'i' } },
            { description: { $regex: keyword, $options: 'i' } },
            { category: { $regex: keyword, $options: 'i' } },
            { tags: { $regex: keyword, $options: 'i' } },
        ]
    }).sort({ date: -1 })

    if(!expenses || expenses.length === 0) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND, 404)
    }

    handleReponses(res, 200, expenses)
})
export const groupExpenseByCategory = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    const expenses = await aggregateExpenses(userId, 'category')

    if(!expenses || expenses.length === 0) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND, 404)
    }

    handleReponses(res, 200, expenses)
})

export const groupExpenseByPaymentMethod = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    const expenses = await aggregateExpenses(userId, 'paymentMethod')

    if(!expenses || expenses.length === 0) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND, 404)
    }

    handleReponses(res, 200, expenses)
})
export const downloadExpense = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    const expenses = await Expense.find({ userId }).sort({ date: -1 })

    if(!expenses || expenses.length === 0) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND, 404)
    }

    const csvData = [
        ['Title,Amount,Description,Category,Date,Payment Method,Recurring,Tags'],
        ...expenses.map(expense => [
            expense.title,
            expense.amount,
            expense.description || 'N/A',
            expense.category || 'N/A',
            expense.date.toISOString().split('T')[0],
            expense.paymentMethod || 'N/A',
            expense.recurring ? 'Yes' : 'No',
            expense.tags?.join(', ') || 'N/A',
        ])
    ]

    const csvString = csvData.map(row => row.join(',')).join('\n')

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename=expenses.csv')
    res.status(200).send(csvString)
})

export const generateExpenseReport = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    const { startDate, endDate } = req.query

    validateRequiredFields({startDate, endDate}, ['startDate', 'endDate'])

    const expenses = await Expense.find({
        userId,
        date: {
            $gte: new Date(startDate as string),
            $lte: new Date(endDate as string),
        }
    }).sort({ date: -1 })

    if(!expenses || expenses.length === 0) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND, 404)
    }

    const totalAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0)

    handleReponses(res, 200, {
        expenses,
        meta:{
            totalAmount,
            totalExpenses: expenses.length,
        }
    })
})

export const duplicateExpense = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    const { expenseId } = req.params

    validateRequiredFields({expenseId}, ['expenseId'])
    const expense = await validateOwnership(Expense, expenseId, userId)

    const duplicatedExpense = await Expense.create({
        userId: expense.userId,
        title: expense.title,
        amount: expense.amount,
        category: expense.category,
        description: expense.description,
        date: new Date(),
        paymentMethod: expense.paymentMethod,
        recurring: expense.recurring,
        tags: expense.tags,
    })

    handleReponses(res, 201, duplicatedExpense)
})
