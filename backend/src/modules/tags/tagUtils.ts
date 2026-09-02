import { Types } from 'mongoose'

import Tag, { ITag } from './tag.model'
import { Transaction } from '@modules/transactions'
import { RecurringRule } from '@modules/recurring'

export const DEFAULT_TAG_COLORS = [
    '#a855f7',
    '#6366f1',
    '#3b82f6',
    '#14b8a6',
    '#22c55e',
    '#eab308',
    '#f97316',
    '#ef4444',
    '#ec4899',
    '#6b7280',
]

export const normalizeTagName = (value: string): string => value.trim()

export const isValidTagName = (name: string): boolean => {
    const normalized = normalizeTagName(name)
    return normalized.length > 0 && normalized.length <= 50
}

export const parseTagsQuery = (tags: unknown): string[] | undefined => {
    if (tags === undefined || tags === null || tags === '') {
        return undefined
    }

    const raw = Array.isArray(tags) ? tags : String(tags).split(',')
    const normalized = [...new Set(raw.map((entry) => normalizeTagName(String(entry))).filter(Boolean))]

    return normalized.length > 0 ? normalized : undefined
}

export const buildTagFilter = (tagNames: string[]): Record<string, unknown> => ({
    tags: { $in: tagNames },
})

export const pickDefaultTagColor = (existingCount: number): string =>
    DEFAULT_TAG_COLORS[existingCount % DEFAULT_TAG_COLORS.length]

export const collectInlineTagNames = async (userId: string): Promise<string[]> => {
    const userObjectId = new Types.ObjectId(userId)

    const [transactionTags, recurringTags] = await Promise.all([
        Transaction.distinct('tags', { userId: userObjectId, tags: { $exists: true, $ne: [] } }),
        RecurringRule.distinct('tags', { userId: userObjectId, tags: { $exists: true, $ne: [] } }),
    ])

    const unique = new Set<string>()
    for (const tagList of [transactionTags, recurringTags]) {
        for (const tag of tagList) {
            const normalized = normalizeTagName(String(tag))
            if (normalized) {
                unique.add(normalized)
            }
        }
    }

    return [...unique].sort((a, b) => a.localeCompare(b))
}

export const dedupeInlineTagsForUser = async (
    userId: string
): Promise<{ created: number; skipped: number; tags: ITag[] }> => {
    const inlineNames = await collectInlineTagNames(userId)
    if (inlineNames.length === 0) {
        return { created: 0, skipped: 0, tags: [] }
    }

    const userObjectId = new Types.ObjectId(userId)
    const existingTags = await Tag.find({ userId: userObjectId }).select('name')
    const existingNames = new Set(existingTags.map((tag) => tag.name.toLowerCase()))

    const toCreate: { userId: Types.ObjectId; name: string; color: string }[] = []
    let skipped = 0

    for (const name of inlineNames) {
        if (existingNames.has(name.toLowerCase())) {
            skipped += 1
            continue
        }

        toCreate.push({
            userId: userObjectId,
            name,
            color: pickDefaultTagColor(existingNames.size + toCreate.length),
        })
        existingNames.add(name.toLowerCase())
    }

    const createdTags = toCreate.length > 0 ? await Tag.insertMany(toCreate) : []

    return {
        created: createdTags.length,
        skipped,
        tags: createdTags,
    }
}

export const renameTagOnTransactions = async (
    userId: string,
    oldName: string,
    newName: string
): Promise<void> => {
    const userObjectId = new Types.ObjectId(userId)

    await Promise.all([
        Transaction.updateMany(
            { userId: userObjectId, tags: oldName },
            { $set: { 'tags.$[tag]': newName } },
            { arrayFilters: [{ tag: oldName }] }
        ),
        RecurringRule.updateMany(
            { userId: userObjectId, tags: oldName },
            { $set: { 'tags.$[tag]': newName } },
            { arrayFilters: [{ tag: oldName }] }
        ),
    ])
}
