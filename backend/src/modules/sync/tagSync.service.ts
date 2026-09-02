import { ITag, Tag } from '@modules/tags'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { DeleteOpOutcome, softDeleteEntityForOp } from './syncEntityHelpers'
import { isDuplicateKeyError, resolveClientObjectId } from '@core/db/objectId'
import { validateRequiredFields } from '@core/http/validation'
import { normalizeTagName, isValidTagName, pickDefaultTagColor, renameTagOnTransactions } from "@modules/tags/tagUtils";
import { validateResourceAccess } from "@modules/workspaces/access";

/**
 * Sprint 13.9: create/update/delete logic for POST /sync/push, mirroring
 * tagController's createTag/updateTag/deleteTag exactly. Tag has a real
 * `deletedAt` soft-delete (unlike account/category/budget), so delete
 * tombstones unconditionally via softDeleteEntityForOp rather than
 * translating to an archive-flag flip.
 */

const validateUserTagForOp = async (tagId: string, userId: string): Promise<ITag> =>
    validateResourceAccess<ITag>(Tag, tagId, userId, ERROR_MESSAGES.TAG.TAG_NOT_FOUND, 'editor')

export const createTagForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<ITag> => {
    validateRequiredFields(payload, ['name'])

    const name = normalizeTagName(String(payload.name))
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
    const color =
        typeof payload.color === 'string' ? payload.color.trim() || pickDefaultTagColor(existingCount) : pickDefaultTagColor(existingCount)
    const clientId = resolveClientObjectId(payload._id)

    try {
        return await Tag.create({ ...(clientId ? { _id: clientId } : {}), userId, name, color })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('A tag with this id already exists', 400)
        }
        throw error
    }
}

export const updateTagForOp = async (
    userId: string,
    payload: Record<string, unknown>
): Promise<ITag> => {
    const tagId = payload._id
    if (typeof tagId !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

    const tag = await validateUserTagForOp(tagId, userId)
    const previousName = tag.name

    const { name, color } = payload as { name?: string; color?: string }

    if (name !== undefined) {
        const trimmedName = normalizeTagName(String(name))
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
        tag.color = color?.trim() || undefined
    }

    const updatedTag = await tag.save()

    if (name !== undefined && previousName !== updatedTag.name) {
        await renameTagOnTransactions(userId, previousName, updatedTag.name)
    }

    return updatedTag
}

export const deleteTagForOp = (
    userId: string,
    payload: Record<string, unknown>
): Promise<DeleteOpOutcome> => softDeleteEntityForOp(Tag, userId, payload, ERROR_MESSAGES.TAG.TAG_NOT_FOUND)
