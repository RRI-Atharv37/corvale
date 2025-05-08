import asyncHandler from 'express-async-handler'
import {Request, Response} from 'express'

import Expense from '../models/Expense'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'

interface AuthRequest extends Request {
    user?: { id: string }
}

export const addExpense = asyncHandler(async(req: Request, res: Response) => {
        const userId = (req as AuthRequest).user?.id
        const { title, amount, source, description, category, date, paymentMethod, recurring, tags } = req.body
    
        if(!userId || !date || !title || !amount || !category) {
            throw new CustomError(ERROR_MESSAGES.EXPENSE.FILL_ALL_FIELDS, 400)
        }
    
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
    
        res.status(201).json({success: true, data: newExpense})
})

export const getExpense = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
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

    res.status(200).json({
        success: true,
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
    const userId = (req as AuthRequest).user?.id
    const { expenseId } = req.params

    if (!expenseId) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.FILL_ALL_FIELDS, 400)
    }

    const expense = await Expense.findOne({ _id: expenseId, userId })

    if (!expense) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND, 404)
    }

    if (expense.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    res.status(200).json({success: true, data: expense})
})

export const updateExpense = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
    const { expenseId } = req.params
    const { title, amount, description, category, date, paymentMethod, recurring, tags } = req.body

    if(!expenseId || !userId) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.FILL_ALL_FIELDS, 400)
    }

    const expense = await Expense.findById({_id: expenseId, userId})

    if (!expense) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND, 404)
    }

    expense.title = title || expense.title
    expense.amount = amount || expense.amount
    expense.description = description || expense.description
    expense.category = category || expense.category
    expense.date = date ? new Date(date) : expense.date
    expense.paymentMethod = paymentMethod || expense.paymentMethod
    expense.recurring = recurring || expense.recurring
    expense.tags = tags || expense.tags

    await expense.save()
    res.status(200).json({success: true, data: expense})
})

export const deleteExpense = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
    const { expenseId } = req.params

    if (!expenseId) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.FILL_ALL_FIELDS, 400)
    }

    const expense = await Expense.findById(expenseId)
    if (!expense) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND, 404)
    }

    if (expense.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    await Expense.deleteOne({ _id: expenseId })
    res.status(200).json({success: true, message: 'Expense deleted successfully'})
})

export const filterExpense = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
    const { startDate, endDate, } = req.query

    if(!userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }
    
    if (!startDate || !endDate) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.FILL_ALL_FIELDS, 400)
    }

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

    res.status(200).json({ success: true, data: expenses })

})

export const searchExpense = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
    const { keyword } = req.query

    if(!userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    if (!keyword) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.FILL_ALL_FIELDS, 400)
    }

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

    res.status(200).json({ success: true, data: expenses })
})
export const groupExpenseByCategory = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id

    const expenses = await Expense.aggregate([
        { $match: { userId } },
        { $group: {
            _id: '$category',
            totalAmount: { $sum: '$amount' },
        }},
        { $sort: { totalAmount: -1 }}
    ])

    if(!expenses || expenses.length === 0) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND, 404)
    }

    res.status(200).json({success: true, data: expenses})
})

export const groupExpenseByPaymentMethod = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id

    const expenses = await Expense.aggregate([
        { $match: { userId } },
        { $group: {
            _id: '$paymentMethod',
            totalAmount: { $sum: '$amount' },
        }},
        { $sort: { totalAmount: -1 }}
    ])

    if(!expenses || expenses.length === 0) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND, 404)
    }

    res.status(200).json({success: true, data: expenses})
})
export const downloadExpense = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id

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
    const userId = (req as AuthRequest).user?.id
    const { startDate, endDate } = req.query

    if(!startDate || !endDate) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.FILL_ALL_FIELDS, 400)
    }

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

    res.status(200).json({
        success: true,
        data: {
            totalAmount,
            expenses,
        },
    })
})

export const duplicateExpense = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
    const { expenseId } = req.params

    if (!expenseId) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.FILL_ALL_FIELDS, 400)
    }

    const expense = await Expense.findById(expenseId)

    if (!expense) {
        throw new CustomError(ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND, 404)
    }

    if (expense.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

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

    res.status(201).json({success: true, data: duplicatedExpense})
})
