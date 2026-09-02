import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import Income from './income.model'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    aggregateIncomes,
    buildSearchRegex,
    getUserId,
    handleResponses,
    validateOwnership,
    validateRequiredFields,
} from './incomeUtils'
import { AuthRequest } from '@http/middleware/authTypes'
import { buildCsvString } from "@modules/transactions/transactionUtils";

export const addIncome = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    validateRequiredFields(req.body, ['title', 'amount', 'date'])

    const { title, amount, source, description, category, date } = req.body

    if (isNaN(Number(amount)) || isNaN(Date.parse(date))) {
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

export const getIncome = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { page = 1, limit = 10 } = req.query

    const pageNumber = Number(page)
    const limitNumber = Number(limit)

    if (isNaN(pageNumber) || isNaN(limitNumber) || pageNumber < 1 || limitNumber < 1) {
        throw new CustomError('Invalid page or limit number', 400)
    }

    const incomes = await Income.find({ userId })
        .sort({ date: -1 })
        .skip((pageNumber - 1) * limitNumber)
        .limit(limitNumber)

    const totalIncomes = await Income.countDocuments({ userId })
    const totalPages = Math.ceil(totalIncomes / limitNumber)

    handleResponses(res, 200, {
        data: incomes,
        meta: {
            totalIncomes,
            pageNumber,
            totalPages,
            limit: limitNumber,
        },
    })
})

export const getIncomeById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { incomeId } = req.params

    validateRequiredFields({ incomeId }, ['incomeId'])

    const income = await validateOwnership(
        Income,
        incomeId,
        userId,
        ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND
    )

    handleResponses(res, 200, income)
})

export const deleteIncome = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { incomeId } = req.params

    validateRequiredFields({ incomeId }, ['incomeId'])

    await validateOwnership(Income, incomeId, userId, ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND)

    await Income.deleteOne({ _id: incomeId })

    handleResponses(res, 200, { message: 'Income deleted successfully' })
})

export const downloadIncome = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const incomes = await Income.find({ userId }).sort({ date: -1 })

    const csvRows = [
        ['Source', 'Title', 'Date', 'Amount', 'Description', 'Category'],
        ...incomes.map((income) => [
            income.source || '',
            income.title,
            income.date.toISOString().split('T')[0],
            income.amount.toString(),
            income.description || '',
            income.category || '',
        ]),
    ]

    const csvString = buildCsvString(csvRows)

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename=incomes.csv')
    res.status(200).send(csvString)
})

export const updateIncome = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { incomeId } = req.params
    const { icon, title, amount, source, description, category, date } = req.body

    validateRequiredFields({ incomeId }, ['incomeId'])
    const income = await validateOwnership(
        Income,
        incomeId,
        userId,
        ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND
    )

    if (amount !== undefined && isNaN(Number(amount))) {
        throw new CustomError('Invalid amount format', 400)
    }
    if (date !== undefined && isNaN(Date.parse(date))) {
        throw new CustomError('Invalid date format', 400)
    }

    if (icon !== undefined) income.icon = icon
    if (title !== undefined) income.title = title
    if (amount !== undefined) income.amount = amount
    if (source !== undefined) income.source = source
    if (description !== undefined) income.description = description
    if (category !== undefined) income.category = category
    if (date !== undefined) income.date = new Date(date)

    const updatedIncome = await income.save()
    handleResponses(res, 200, updatedIncome)
})

export const filterIncomeByDate = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { startDate, endDate } = req.query

    validateRequiredFields({ startDate, endDate }, ['startDate', 'endDate'])

    const incomes = await Income.find({
        userId,
        date: {
            $gte: new Date(startDate as string),
            $lte: new Date(endDate as string),
        },
    }).sort({ date: -1 })

    handleResponses(res, 200, incomes)
})

export const groupIncomeByCategory = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const incomes = await aggregateIncomes(userId, 'category')

    handleResponses(res, 200, incomes)
})

export const searchIncome = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { keyword } = req.query

    validateRequiredFields({ keyword }, ['keyword'])

    const regex = buildSearchRegex(keyword as string)
    const numericKeyword = !isNaN(Number(keyword)) ? Number(keyword) : null
    const dateKeyword = !isNaN(Date.parse(keyword as string)) ? new Date(keyword as string) : null

    const incomes = await Income.find({
        userId,
        $or: [
            { title: { $regex: regex } },
            { source: { $regex: regex } },
            { description: { $regex: regex } },
            { category: { $regex: regex } },
            ...(dateKeyword ? [{ date: dateKeyword }] : []),
            ...(numericKeyword !== null ? [{ amount: numericKeyword }] : []),
        ],
    }).sort({ date: -1 })

    handleResponses(res, 200, incomes)
})

export const duplicateIncome = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { incomeId } = req.params

    validateRequiredFields({ incomeId }, ['incomeId'])

    const income = await validateOwnership(
        Income,
        incomeId,
        userId,
        ERROR_MESSAGES.INCOME.INCOME_NOT_FOUND
    )

    const duplicateIncomeEntry = await Income.create({
        userId: income.userId,
        icon: income.icon,
        title: income.title,
        amount: income.amount,
        source: income.source,
        description: income.description,
        category: income.category,
        date: new Date(),
    })

    handleResponses(res, 201, duplicateIncomeEntry)
})
