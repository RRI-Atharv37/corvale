import asyncHandler from 'express-async-handler'
import {Request, Response} from 'express'

import Income from '../models/Income'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'

interface AuthRequest extends Request {
    user?: { id: string }
}

export const addIncome = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
    const { title, amount, source, description, category, date } = req.body

    if(!userId || !date || !title || !amount) {
        throw new CustomError(ERROR_MESSAGES.INCOME.FILL_ALL_FIELDS, 400)
    }

    if (isNaN(amount) || isNaN(Date.parse(date))) {
        throw new CustomError('Invalid amount or date format', 400)
    }

    const newIncome = await Income.create({
        userId,
        title,
        amount,
        source,
        description,
        category,
        date: new Date(date),
    })

    res.status(201).json({success: true, data: newIncome})
})

export const getIncome = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
    const { page = 1, limit = 10 } = req.query

    const pageNumber = Number(page)
    const limitNumber = Number(limit)

    if(isNaN(pageNumber) || isNaN(limitNumber) || pageNumber < 1 || limitNumber < 1) {
        throw new CustomError('Invalid page or limit number', 400)
    }

    const incomes = await Income.find({userId})
        .sort({date: -1})
        .skip((pageNumber - 1) * limitNumber)
        .limit(limitNumber)

    const totalIncomes = await Income.countDocuments({userId})
    const totalPages = Math.ceil(totalIncomes / limitNumber)

    res.status(200).json({
        success: true,
        data: incomes,
        meta: {
            totalIncomes,
            pageNumber,
            totalPages: totalPages,
            limit: limitNumber,
        }
    })
})

export const getIncomeById = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
    const { incomeId } = req.params

    if (!incomeId) {
        throw new CustomError(ERROR_MESSAGES.INCOME.FILL_ALL_FIELDS, 400)
    }

    const income = await Income.findOne({ _id: incomeId, userId })

    if (!income) {
        throw new CustomError(ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND, 404)
    }

    if (income.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    res.status(200).json({success: true, data: income})
})

export const deleteIncome = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
    const { incomeId } = req.params

    if (!incomeId) {
        throw new CustomError(ERROR_MESSAGES.INCOME.FILL_ALL_FIELDS, 400)
    }

    const income = await Income.findById(incomeId)
    if (!income) {
        throw new CustomError(ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND, 404)
    }

    if (income.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    await Income.deleteOne({ _id: incomeId })
    res.status(200).json({success: true, message: 'Income deleted successfully'})
})

export const downloadIncome = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id

    const incomes = await Income.find({ userId }).sort({ date: -1 })
    if (!incomes || incomes.length === 0) {
        throw new CustomError(ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND, 404)
    }

    const csvRows = [
        ['Source', 'Title', 'Date', 'Amount', 'Description', 'Category'],
        ...incomes.map(income => [
            income.source || '',
            income.title,
            income.date.toISOString().split('T')[0],
            income.amount.toString(),
            income.description || '',
            income.category || ''
        ])
    ]

    const csvString = csvRows.map(row => row.join(',')).join('\n')

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename=incomes.csv')
    res.status(200).send(csvString)

    // console.log('CSV String:', csvString)
    // console.log('Response Headers:', res.getHeaders())
})

export const updateIncome = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
    const { incomeId } = req.params
    const { icon, title, amount, source, description, category, date } = req.body

    if (!incomeId || !date || !title || !amount) {
        throw new CustomError(ERROR_MESSAGES.INCOME.FILL_ALL_FIELDS, 400)
    }

    if (amount && isNaN(amount)) {
        throw new CustomError('Invalid amount format', 400)
    }
    if (date && isNaN(Date.parse(date))) {
        throw new CustomError('Invalid date format', 400)
    }

    const income = await Income.findById(incomeId)

    if (!income) {
        throw new CustomError(ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND, 404)
    }

    if (income.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    if (icon) income.icon = icon
    if (title) income.title = title
    if (amount) income.amount = amount
    if (source) income.source = source
    if (description) income.description = description
    if (category) income.category = category
    if (date) income.date = new Date(date)

    const updatedIncome = await income.save()
    res.status(200).json({success: true, data: updatedIncome})
})

export const filterIncomeByDate = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
    const { startDate, endDate } = req.query

    if (!startDate || !endDate) {
        throw new CustomError(ERROR_MESSAGES.INCOME.FILL_ALL_FIELDS, 400)
    }

    const incomes = await Income.find({
        userId,
        date: {
            $gte: new Date(startDate as string),
            $lte: new Date(endDate as string),
        },
    }).sort({ date: -1 })

    if (!incomes || incomes.length === 0) {
        throw new CustomError(ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND, 404)
    }

    res.status(200).json({success: true, data: incomes})
})

// export const getTotalIncome = asyncHandler(async(req: Request, res: Response) => {})

export const groupIncomeByCategory = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id

    const incomes = await Income.aggregate([
        { $match: { userId }},
        { $group: {
            _id: '$category',
            totalAmount: { $sum: '$amount' },
        }},
        { $sort: { totalAmount: -1 }}
    ])

    if(!incomes || incomes.length === 0) {
        throw new CustomError(ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND, 404)
    }

    res.status(200).json({success: true, data: incomes})
})

export const searchIncome = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
    const {keyword} = req.query

    if(!keyword) {
        throw new CustomError(ERROR_MESSAGES.INCOME.FILL_ALL_FIELDS, 400)
    }

    const numericKeyword = !isNaN(Number(keyword)) ? Number(keyword) : null
    const dateKeyword = !isNaN(Date.parse(keyword as string)) ? new Date(keyword as string) : null

    const incomes = await Income.find({
        userId,
        $or: [
            { title: { $regex: keyword, $options: 'i' }},
            { source: { $regex: keyword, $options: 'i' }},
            { description: { $regex: keyword, $options: 'i' }},
            { category: { $regex: keyword, $options: 'i' }},
            ...(dateKeyword ? [{ date: dateKeyword }] : []),
            ...(numericKeyword !== null ? [{ amount: numericKeyword }] : []),
        ]
    }).sort({ date: -1 })

    if(!incomes || incomes.length === 0) {
        throw new CustomError(ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND, 404)
    }

    res.status(200).json({success: true, data: incomes})
})

export const duplicateIncome = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
    const { incomeId } = req.params

    if (!incomeId) {
        throw new CustomError(ERROR_MESSAGES.INCOME.FILL_ALL_FIELDS, 400)
    }

    const income = await Income.findById(incomeId)

    if (!income) {
        throw new CustomError(ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND, 404)
    }

    if (income.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    const duplicateIncome = await Income.create({
        ...income.toObject(),
        _id: undefined,
        date: new Date(),
    })

    res.status(201).json({success: true, data: duplicateIncome})
})