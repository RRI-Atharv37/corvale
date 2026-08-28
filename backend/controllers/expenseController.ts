import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import Expense from '../models/Expense'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { buildCsvString } from '../utils/transactionUtils'
import {
    aggregateExpenses,
    buildSearchRegex,
    getUserId,
    handleResponses,
    validateOwnership,
    validateRequiredFields,
} from '../utils/expenseUtils'
import { AuthRequest } from '../middleware/authTypes'

export const addExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    validateRequiredFields(req.body, ['title', 'amount', 'category', 'date'])

    const { title, amount, source, description, category, date, paymentMethod, recurring, tags } = req.body

    if (isNaN(Number(amount)) || isNaN(Date.parse(date))) {
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

    handleResponses(res, 201, newExpense)
})

export const getExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { page = 1, limit = 10 } = req.query

    const pageNumber = Number(page)
    const limitNumber = Number(limit)

    if (isNaN(pageNumber) || isNaN(limitNumber) || pageNumber < 1 || limitNumber < 1) {
        throw new CustomError('Invalid page or limit number', 400)
    }

    const expenses = await Expense.find({ userId })
        .sort({ date: -1 })
        .skip((pageNumber - 1) * limitNumber)
        .limit(limitNumber)

    const totalExpenses = await Expense.countDocuments({ userId })
    const totalPages = Math.ceil(totalExpenses / limitNumber)

    handleResponses(res, 200, {
        data: expenses,
        meta: {
            totalExpenses,
            pageNumber,
            totalPages,
            limit: limitNumber,
        },
    })
})

export const getExpenseById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { expenseId } = req.params

    validateRequiredFields({ expenseId }, ['expenseId'])

    const expense = await validateOwnership(
        Expense,
        expenseId,
        userId,
        ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND
    )

    handleResponses(res, 200, expense)
})

export const updateExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { expenseId } = req.params
    const { title, amount, description, category, date, paymentMethod, recurring, tags } = req.body

    const expense = await validateOwnership(
        Expense,
        expenseId,
        userId,
        ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND
    )

    if (title !== undefined) expense.title = title
    if (amount !== undefined) {
        if (isNaN(Number(amount))) {
            throw new CustomError('Invalid amount format', 400)
        }
        expense.amount = amount
    }
    if (description !== undefined) expense.description = description
    if (category !== undefined) expense.category = category
    if (date !== undefined) {
        if (isNaN(Date.parse(date))) {
            throw new CustomError('Invalid date format', 400)
        }
        expense.date = new Date(date)
    }
    if (paymentMethod !== undefined) expense.paymentMethod = paymentMethod
    if (recurring !== undefined) expense.recurring = recurring
    if (tags !== undefined) expense.tags = tags

    await expense.save()
    handleResponses(res, 200, expense)
})

export const deleteExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { expenseId } = req.params

    validateRequiredFields({ expenseId }, ['expenseId'])

    await validateOwnership(Expense, expenseId, userId, ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND)

    await Expense.deleteOne({ _id: expenseId })

    handleResponses(res, 200, { message: 'Expense deleted successfully' })
})

export const filterExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { startDate, endDate } = req.query

    validateRequiredFields({ startDate, endDate }, ['startDate', 'endDate'])

    const expenses = await Expense.find({
        userId,
        date: {
            $gte: new Date(startDate as string),
            $lte: new Date(endDate as string),
        },
    }).sort({ date: -1 })

    handleResponses(res, 200, expenses)
})

export const searchExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { keyword } = req.query

    validateRequiredFields({ keyword }, ['keyword'])

    const regex = buildSearchRegex(keyword as string)

    const expenses = await Expense.find({
        userId,
        $or: [
            { title: { $regex: regex } },
            { description: { $regex: regex } },
            { category: { $regex: regex } },
            { tags: { $regex: regex } },
        ],
    }).sort({ date: -1 })

    handleResponses(res, 200, expenses)
})

export const groupExpenseByCategory = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const expenses = await aggregateExpenses(userId, 'category')

    handleResponses(res, 200, expenses)
})

export const groupExpenseByPaymentMethod = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const expenses = await aggregateExpenses(userId, 'paymentMethod')

    handleResponses(res, 200, expenses)
})

export const downloadExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const expenses = await Expense.find({ userId }).sort({ date: -1 })

    const csvData = [
        ['Title', 'Amount', 'Description', 'Category', 'Date', 'Payment Method', 'Recurring', 'Tags'],
        ...expenses.map((expense) => [
            expense.title,
            expense.amount.toString(),
            expense.description || 'N/A',
            expense.category || 'N/A',
            expense.date.toISOString().split('T')[0],
            expense.paymentMethod || 'N/A',
            expense.recurring ? 'Yes' : 'No',
            expense.tags?.join(', ') || 'N/A',
        ]),
    ]

    const csvString = buildCsvString(csvData)

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename=expenses.csv')
    res.status(200).send(csvString)
})

export const generateExpenseReport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { startDate, endDate } = req.query

    validateRequiredFields({ startDate, endDate }, ['startDate', 'endDate'])

    const expenses = await Expense.find({
        userId,
        date: {
            $gte: new Date(startDate as string),
            $lte: new Date(endDate as string),
        },
    }).sort({ date: -1 })

    const totalAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0)

    handleResponses(res, 200, {
        expenses,
        meta: {
            totalAmount,
            totalExpenses: expenses.length,
        },
    })
})

export const duplicateExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { expenseId } = req.params

    validateRequiredFields({ expenseId }, ['expenseId'])
    const expense = await validateOwnership(
        Expense,
        expenseId,
        userId,
        ERROR_MESSAGES.EXPENSE.EXPENSE_NOT_FOUND
    )

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

    handleResponses(res, 201, duplicatedExpense)
})
