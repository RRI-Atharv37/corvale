import Category, { ICategory } from '../models/Category'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { ensureMasterCategoriesSeeded, isMasterCategory } from '../utils/categorySeed'
import { DeleteOpOutcome } from './syncEntityHelpers'
import { isDuplicateKeyError, resolveClientObjectId } from '@core/db/objectId'
import { validateRequiredFields } from '@core/http/validation'

/**
 * Sprint 13.9: create/update/delete logic for POST /sync/push, mirroring
 * categoryController's createCategory/updateCategory/archiveCategory.
 *
 * Categories predate Sprint 13.2's client-generated-`_id` convention — the
 * REST createCategory endpoint doesn't call resolveClientObjectId — but a
 * sync create absolutely needs it: without it, an offline-created category
 * would get a server-assigned id that never matches the local SQLite row's
 * id. This adds resolveClientObjectId support here (not to the REST
 * controller), mirroring how account/budget/tag/etc. already do it.
 */

const unsetPreviousDefault = async (userId: string, excludeCategoryId?: string): Promise<void> => {
    const filter: Record<string, unknown> = { userId, isDefault: true, isArchived: false }
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

/**
 * Categories have a `userId: null` master-category concept (seeded, shared,
 * never client-writable). A sync op targeting a master must be rejected
 * with the same CANNOT_MODIFY_MASTER error the REST endpoints use rather
 * than crashing on a null userId comparison — this is why category can't
 * reuse the generic validateResourceAccess helper the other archive-flag
 * entities use.
 */
export const validateUserCategoryForOp = async (
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

export const createCategoryForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<ICategory> => {
    await ensureMasterCategoriesSeeded()
    validateRequiredFields(payload, ['masterCategoryId', 'name'])

    const { masterCategoryId, name, icon, color, isDefault, sortOrder } = payload as {
        masterCategoryId: string
        name: string
        icon?: string
        color?: string
        isDefault?: boolean
        sortOrder?: number
    }

    await getMasterCategory(masterCategoryId)

    const trimmedName = String(name).trim()
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

    const clientId = resolveClientObjectId(payload._id)

    try {
        return await Category.create({
            ...(clientId ? { _id: clientId } : {}),
            userId,
            masterCategoryId,
            name: trimmedName,
            icon: icon?.trim(),
            color: color?.trim(),
            isDefault: shouldBeDefault,
            sortOrder: resolvedSortOrder,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('A category with this id already exists', 400)
        }
        throw error
    }
}

export const updateCategoryForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<ICategory> => {
    const categoryId = payload._id
    if (typeof categoryId !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

    const category = await validateUserCategoryForOp(categoryId, userId)

    if (category.isArchived) {
        throw new CustomError(ERROR_MESSAGES.CATEGORY.CATEGORY_ARCHIVED, 400)
    }

    const { name, icon, color, isDefault } = payload as {
        name?: string
        icon?: string
        color?: string
        isDefault?: boolean
    }

    if (name !== undefined) {
        const trimmedName = String(name).trim()
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
        category.icon = icon?.trim() || undefined
    }

    if (color !== undefined) {
        category.color = color?.trim() || undefined
    }

    if (isDefault === true) {
        await unsetPreviousDefault(userId, categoryId)
        category.isDefault = true
    } else if (isDefault === false && category.isDefault) {
        throw new CustomError(ERROR_MESSAGES.CATEGORY.CANNOT_UNSET_DEFAULT, 400)
    }

    return category.save()
}

export const deleteCategoryForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<DeleteOpOutcome> => {
    const categoryId = payload._id
    if (typeof categoryId !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

    const category = await validateUserCategoryForOp(categoryId, userId)

    // Unlike the REST archive endpoint, a sync delete op landing on an
    // already-archived category resolves as a no-op rather than throwing
    // CATEGORY_ALREADY_ARCHIVED — see archiveEntityForOp's doc comment in
    // syncEntityHelpers.ts for why.
    if (category.isArchived) {
        return { status: 'noop', resultId: category._id.toString() }
    }

    category.isArchived = true
    category.isDefault = false
    await category.save()

    return { status: 'applied', resultId: category._id.toString() }
}
