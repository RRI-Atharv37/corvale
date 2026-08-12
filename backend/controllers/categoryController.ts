import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import Category, { ICategory } from '../models/Category'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { ensureMasterCategoriesSeeded, isMasterCategory } from '../utils/categorySeed'
import {
    getUserId,
    handleResponses,
    validateRequiredFields,
} from '../utils/sharedUtils'

const unsetPreviousDefault = async (userId: string, excludeCategoryId?: string): Promise<void> => {
    const filter: Record<string, unknown> = {
        userId: new Types.ObjectId(userId),
        isDefault: true,
        isArchived: false,
    }
    if (excludeCategoryId) {
        filter._id = { $ne: excludeCategoryId }
    }
    await Category.updateMany(filter, { $set: { isDefault: false } })
}

const getMasterCategory = async (masterCategoryId: string): Promise<ICategory> => {
    const master = await Category.findById(masterCategoryId)
    if (!master || !isMasterCategory(master)) {
        throw new CustomError(ERROR_MESSAGES.CATEGORY.MASTER_NOT_FOUND, 404)
    }
    return master
}

const validateUserCategory = async (
    categoryId: string,
    userId: string
): Promise<ICategory> => {
    const category = await Category.findById(categoryId)
    if (!category) {
        throw new CustomError(ERROR_MESSAGES.CATEGORY.CATEGORY_NOT_FOUND, 404)
    }

    if (isMasterCategory(category)) {
        throw new CustomError(ERROR_MESSAGES.CATEGORY.CANNOT_MODIFY_MASTER, 403)
    }

    if (category.userId?.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    return category
}

export const createCategory = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    await ensureMasterCategoriesSeeded()

    validateRequiredFields(req.body, ['masterCategoryId', 'name'])

    const { masterCategoryId, name, icon, color, isDefault, sortOrder } = req.body

    await getMasterCategory(masterCategoryId)

    const trimmedName = name.trim()
    if (!trimmedName) {
        throw new CustomError('Category name cannot be empty', 400)
    }

    const duplicate = await Category.findOne({
        userId,
        masterCategoryId,
        name: trimmedName,
        isArchived: false,
    })
    if (duplicate) {
        throw new CustomError(ERROR_MESSAGES.CATEGORY.CATEGORY_ALREADY_EXISTS, 400)
    }

    let resolvedSortOrder = sortOrder
    if (resolvedSortOrder === undefined || resolvedSortOrder === null) {
        const maxSort = await Category.findOne({ userId, masterCategoryId })
            .sort({ sortOrder: -1 })
            .select('sortOrder')
        resolvedSortOrder = (maxSort?.sortOrder ?? -1) + 1
    }

    const shouldBeDefault = isDefault === true
    if (shouldBeDefault) {
        await unsetPreviousDefault(userId)
    }

    const category = await Category.create({
        userId,
        masterCategoryId,
        name: trimmedName,
        icon: icon?.trim(),
        color: color?.trim(),
        isDefault: shouldBeDefault,
        sortOrder: resolvedSortOrder,
    })

    handleResponses(res, 201, category)
})

export const getCategories = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    await ensureMasterCategoriesSeeded()

    const includeArchived = req.query.includeArchived === 'true'

    const masterFilter: Record<string, unknown> = { userId: null }
    const userFilter: Record<string, unknown> = { userId: new Types.ObjectId(userId) }

    if (!includeArchived) {
        masterFilter.isArchived = false
        userFilter.isArchived = false
    }

    const [masters, userCategories] = await Promise.all([
        Category.find(masterFilter).sort({ sortOrder: 1, name: 1 }),
        Category.find(userFilter).sort({ sortOrder: 1, name: 1 }),
    ])

    handleResponses(res, 200, { masters, userCategories })
})

export const getCategoryById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { categoryId } = req.params

    validateRequiredFields({ categoryId }, ['categoryId'])
    await ensureMasterCategoriesSeeded()

    const category = await Category.findById(categoryId)
    if (!category) {
        throw new CustomError(ERROR_MESSAGES.CATEGORY.CATEGORY_NOT_FOUND, 404)
    }

    if (isMasterCategory(category)) {
        handleResponses(res, 200, category)
        return
    }

    if (category.userId?.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    handleResponses(res, 200, category)
})

export const updateCategory = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { categoryId } = req.params
    const { name, icon, color, isDefault } = req.body

    validateRequiredFields({ categoryId }, ['categoryId'])

    const category = await validateUserCategory(categoryId, userId)

    if (category.isArchived) {
        throw new CustomError(ERROR_MESSAGES.CATEGORY.CATEGORY_ARCHIVED, 400)
    }

    if (name !== undefined) {
        const trimmedName = name.trim()
        if (!trimmedName) {
            throw new CustomError('Category name cannot be empty', 400)
        }

        const duplicate = await Category.findOne({
            _id: { $ne: categoryId },
            userId,
            masterCategoryId: category.masterCategoryId,
            name: trimmedName,
            isArchived: false,
        })
        if (duplicate) {
            throw new CustomError(ERROR_MESSAGES.CATEGORY.CATEGORY_ALREADY_EXISTS, 400)
        }

        category.name = trimmedName
    }

    if (icon !== undefined) {
        category.icon = icon.trim() || undefined
    }

    if (color !== undefined) {
        category.color = color.trim() || undefined
    }

    if (isDefault === true) {
        await unsetPreviousDefault(userId, categoryId)
        category.isDefault = true
    } else if (isDefault === false && category.isDefault) {
        throw new CustomError(ERROR_MESSAGES.CATEGORY.CANNOT_UNSET_DEFAULT, 400)
    }

    const updatedCategory = await category.save()
    handleResponses(res, 200, updatedCategory)
})

export const archiveCategory = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { categoryId } = req.params

    validateRequiredFields({ categoryId }, ['categoryId'])

    const category = await validateUserCategory(categoryId, userId)

    if (category.isArchived) {
        throw new CustomError(ERROR_MESSAGES.CATEGORY.CATEGORY_ALREADY_ARCHIVED, 400)
    }

    category.isArchived = true
    category.isDefault = false
    await category.save()

    handleResponses(res, 200, { message: 'Category archived successfully', data: category })
})

export const reorderCategories = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    validateRequiredFields(req.body, ['orderedIds'])

    const { orderedIds } = req.body
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
        throw new CustomError('orderedIds must be a non-empty array', 400)
    }

    const categories = await Category.find({
        _id: { $in: orderedIds },
        userId,
        isArchived: false,
    })

    if (categories.length !== orderedIds.length) {
        throw new CustomError(ERROR_MESSAGES.CATEGORY.INVALID_REORDER, 400)
    }

    const updates = orderedIds.map((id: string, index: number) =>
        Category.updateOne({ _id: id, userId }, { $set: { sortOrder: index } })
    )
    await Promise.all(updates)

    const updated = await Category.find({
        _id: { $in: orderedIds },
        userId,
    }).sort({ sortOrder: 1 })

    handleResponses(res, 200, updated)
})
