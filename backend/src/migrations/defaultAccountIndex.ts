import { isDeepStrictEqual } from 'node:util'

import { Account } from '@modules/accounts'

export interface DefaultAccountIndexOptions {
    dryRun?: boolean
}

export type DefaultAccountIndexResult =
    | { dryRun: false; rebuilt: boolean }
    | { dryRun: true; rebuilt: false; needsRebuild: boolean }

const KEY = { userId: 1, isDefault: 1 }

const schemaDefinition = () => {
    const entry = Account.schema.indexes().find(([fields]) => isDeepStrictEqual(fields, KEY))
    if (!entry) throw new Error('Account schema has no default-account index')
    return entry[1] as { unique?: boolean; partialFilterExpression?: Record<string, unknown> }
}

/**
 * BUG-59 follow-up: the one-default-account index used to span workspace accounts too, so a legacy
 * shared account flagged default blocked the owner from setting any personal default (E11000). The
 * schema now scopes it to `workspaceId: null`; Mongoose will not change an existing index's options,
 * so this drops the old one and builds it from the schema definition. A re-run is a no-op.
 */
export const migrateDefaultAccountIndex = async (options: DefaultAccountIndexOptions = {}): Promise<DefaultAccountIndexResult> => {
    const { dryRun = false } = options
    const wanted = schemaDefinition()

    const current = (await Account.collection.indexes()).find((index) => isDeepStrictEqual(index.key, KEY))
    const isCurrent =
        current !== undefined &&
        current.unique === wanted.unique &&
        isDeepStrictEqual(current.partialFilterExpression, wanted.partialFilterExpression)

    if (dryRun) return { dryRun: true, rebuilt: false, needsRebuild: !isCurrent }
    if (isCurrent) return { dryRun: false, rebuilt: false }

    if (current?.name) await Account.collection.dropIndex(current.name)
    await Account.collection.createIndex(KEY, { unique: wanted.unique, partialFilterExpression: wanted.partialFilterExpression })

    return { dryRun: false, rebuilt: true }
}
