import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import Tag, { ITag } from '../models/Tag'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import {
    dedupeInlineTagsForUser,
    isValidTagName,
    normalizeTagName,
    pickDefaultTagColor,
    renameTagOnTransactions,
} from '../utils/tagUtils'
import {
    getUserId,
    handleResponses,
    validateRequiredFields,
} from '../utils/sharedUtils'

const validateUserTag = async (tagId: string, userId: string): Promise<ITag> => {
    const tag = await Tag.findById(tagId)
    if (!tag) {
        throw new CustomError(ERROR_MESSAGES.TAG.TAG_NOT_FOUND, 404)
    }

    if (tag.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    return tag
}

export const createTag = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    validateRequiredFields(req.body, ['name'])

    const name = normalizeTagName(req.body.name)
    if (!isValidTagName(name)) {
        throw new CustomError('Tag name must be between 1 and 50 characters', 400)
    }

    const duplicate = await Tag.findOne({
        userId,
        name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    })
    if (duplicate) {
        throw new CustomError(ERROR_MESSAGES.TAG.TAG_ALREADY_EXISTS, 400)
    }

    const existingCount = await Tag.countDocuments({ userId })
    const color = req.body.color?.trim() || pickDefaultTagColor(existingCount)

    const tag = await Tag.create({ userId, name, color })

    handleResponses(res, 201, tag)
})

export const getTags = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const tags = await Tag.find({ userId }).sort({ name: 1 })

    handleResponses(res, 200, tags)
})

export const getTagById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { tagId } = req.params

    validateRequiredFields({ tagId }, ['tagId'])

    const tag = await validateUserTag(tagId, userId)

    handleResponses(res, 200, tag)
})

export const updateTag = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { tagId } = req.params
    const { name, color } = req.body

    validateRequiredFields({ tagId }, ['tagId'])

    const tag = await validateUserTag(tagId, userId)
    const previousName = tag.name

    if (name !== undefined) {
        const trimmedName = normalizeTagName(name)
        if (!isValidTagName(trimmedName)) {
            throw new CustomError('Tag name must be between 1 and 50 characters', 400)
        }

        const duplicate = await Tag.findOne({
            _id: { $ne: tagId },
            userId,
            name: { $regex: new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        })
        if (duplicate) {
            throw new CustomError(ERROR_MESSAGES.TAG.TAG_ALREADY_EXISTS, 400)
        }

        tag.name = trimmedName
    }

    if (color !== undefined) {
        tag.color = color.trim() || undefined
    }

    const updatedTag = await tag.save()

    if (name !== undefined && previousName !== updatedTag.name) {
        await renameTagOnTransactions(userId, previousName, updatedTag.name)
    }

    handleResponses(res, 200, updatedTag)
})

export const deleteTag = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { tagId } = req.params

    validateRequiredFields({ tagId }, ['tagId'])

    const tag = await validateUserTag(tagId, userId)
    await tag.deleteOne()

    handleResponses(res, 200, { message: 'Tag deleted successfully' })
})

export const dedupeTags = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    const result = await dedupeInlineTagsForUser(userId)

    handleResponses(res, 200, {
        message: `Imported ${result.created} tag${result.created === 1 ? '' : 's'} from existing transactions`,
        created: result.created,
        skipped: result.skipped,
        tags: result.tags,
    })
})
