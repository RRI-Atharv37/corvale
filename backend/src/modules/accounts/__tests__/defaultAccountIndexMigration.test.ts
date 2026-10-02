import { afterEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'

import { Account } from '@modules/accounts'
import { migrateDefaultAccountIndex } from '@migrations/defaultAccountIndex'

/**
 * BUG-59 follow-up: only personal accounts may be default, so the one-default index is scoped to
 * `workspaceId: null`. A deployment created before that still holds the index under the same name
 * with the old filter, which Mongoose will not replace on its own.
 */

const KEY = { userId: 1, isDefault: 1 }
const LEGACY_OPTIONS = { unique: true, partialFilterExpression: { isDefault: true, isArchived: false } }

const defaultIndex = async () =>
    (await Account.collection.indexes()).find((index) => JSON.stringify(index.key) === JSON.stringify(KEY))

const installLegacyIndex = async () => {
    const current = await defaultIndex()
    if (current?.name) await Account.collection.dropIndex(current.name)
    await Account.collection.createIndex(KEY, LEGACY_OPTIONS)
}

afterEach(async () => {
    await migrateDefaultAccountIndex()
})

describe('migrateDefaultAccountIndex', () => {
    it('rebuilds a legacy index with the personal-only filter', async () => {
        await installLegacyIndex()

        const result = await migrateDefaultAccountIndex()

        expect(result).toEqual({ dryRun: false, rebuilt: true })
        expect((await defaultIndex())?.partialFilterExpression).toEqual({ isDefault: true, isArchived: false, workspaceId: null })
        expect((await defaultIndex())?.unique).toBe(true)
    })

    it('reports without touching anything on a dry run', async () => {
        await installLegacyIndex()

        const result = await migrateDefaultAccountIndex({ dryRun: true })

        expect(result).toEqual({ dryRun: true, rebuilt: false, needsRebuild: true })
        expect((await defaultIndex())?.partialFilterExpression).toEqual(LEGACY_OPTIONS.partialFilterExpression)
    })

    it('is a no-op once the index is current', async () => {
        await migrateDefaultAccountIndex()

        expect(await migrateDefaultAccountIndex()).toEqual({ dryRun: false, rebuilt: false })
        expect(await migrateDefaultAccountIndex({ dryRun: true })).toEqual({ dryRun: true, rebuilt: false, needsRebuild: false })
    })

    it('lets a legacy shared default coexist with a personal default once rebuilt', async () => {
        await installLegacyIndex()
        await migrateDefaultAccountIndex()
        const userId = new Types.ObjectId()
        const base = { userId, type: 'checking', currency: 'USD', openingBalance: 0, currentBalance: 0, isDefault: true }

        await Account.collection.insertOne({ ...base, name: 'Shared', workspaceId: new Types.ObjectId(), isArchived: false })
        await Account.collection.insertOne({ ...base, name: 'Personal', workspaceId: null, isArchived: false })

        await expect(
            Account.collection.insertOne({ ...base, name: 'Second personal', workspaceId: null, isArchived: false })
        ).rejects.toThrow(/duplicate key/)
    })
})
