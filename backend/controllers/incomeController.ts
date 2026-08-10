import asyncHandler from 'express-async-handler'
import {Request, Response} from 'express'

import Income from '../models/Income'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { aggregateIncomes, getUserId, handleResponses, validateOwnership, validateRequiredFields } from '../utils/incomeUtils'

interface AuthRequest extends Request {
    user?: { id: string }
}

export const addIncome = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    
    validateRequiredFields(req.body, ['userId', 'title', 'amount', 'date'])

    const { title, amount, source, description, category, date } = req.body

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

    handleResponses(res, 201, newIncome)
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

    handleResponses(res, 200, {
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
    const userId = getUserId(req as AuthRequest)
    const { incomeId } = req.params

    validateRequiredFields({incomeId}, ['incomeId'])

    const income = await validateOwnership(Income, incomeId, userId)

    handleResponses(res, 200, income)
})

export const deleteIncome = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    const { incomeId } = req.params

    validateRequiredFields({incomeId}, ['incomeId'])

    await validateOwnership(Income, incomeId, userId)

    await Income.deleteOne({ _id: incomeId })

    handleResponses(res, 200, { message: 'Income deleted successfully' })
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
    const userId = getUserId(req as AuthRequest)
    const { incomeId } = req.params
    const { icon, title, amount, source, description, category, date } = req.body

    validateRequiredFields({incomeId}, ['incomeId'])
    const income = await validateOwnership(Income, incomeId, userId)

    if (amount && isNaN(amount)) {
        throw new CustomError('Invalid amount format', 400)
    }
    if (date && isNaN(Date.parse(date))) {
        throw new CustomError('Invalid date format', 400)
    }

    if (icon) income.icon = icon
    if (title) income.title = title
    if (amount) income.amount = amount
    if (source) income.source = source
    if (description) income.description = description
    if (category) income.category = category
    if (date) income.date = new Date(date)

    const updatedIncome = await income.save()
    handleResponses(res, 200, updatedIncome)
})

export const filterIncomeByDate = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    const { startDate, endDate } = req.query

    validateRequiredFields({startDate, endDate}, ['startDate', 'endDate'])

    const incomes = await aggregateIncomes(userId, 'date')

    if (!incomes || incomes.length === 0) {
        throw new CustomError(ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND, 404)
    }

    handleResponses(res, 200, incomes)
})

export const groupIncomeByCategory = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)

    const incomes = await aggregateIncomes(userId, 'category')

    if(!incomes || incomes.length === 0) {
        throw new CustomError(ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND, 404)
    }

    handleResponses(res, 200, incomes)
})

export const searchIncome = asyncHandler(async(req: Request, res: Response) => {
    const userId = (req as AuthRequest).user?.id
    const {keyword} = req.query

    validateRequiredFields({keyword}, ['keyword'])

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

    handleResponses(res, 200, incomes)
})

export const duplicateIncome = asyncHandler(async(req: Request, res: Response) => {
    const userId = getUserId(req as AuthRequest)
    const { incomeId } = req.params

    validateRequiredFields({incomeId}, ['incomeId'])

    const income = await validateOwnership(Income, incomeId, userId)

    const duplicateIncome = await Income.create({
        ...income.toObject(),
        _id: undefined,
        date: new Date(),
    })

    handleResponses(res, 201, duplicateIncome)
})