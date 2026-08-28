import { Document, Model, Types } from 'mongoose'

import Account from '../models/Account'
import Budget from '../models/Budget'
import Category from '../models/Category'
import CategorizationRule from '../models/CategorizationRule'
import RecurringRule from '../models/RecurringRule'
import SavingsGoal from '../models/SavingsGoal'
import SavingsGoalContribution from '../models/SavingsGoalContribution'
import Tag from '../models/Tag'
import Transaction from '../models/Transaction'
import TransactionTemplate from '../models/TransactionTemplate'
import { CustomError } from '../utils/customError'
import { SOFT_DELETE_BYPASS } from '../utils/softDelete'
import { buildScopedListFilter } from '../utils/workspaceUtils'

/**
 * Sprint 13.3 sync surface: bootstrap (full snapshot) + pull (checkpoint
 * pagination) share the same entity registry and checkpoint format so a
 * bootstrap's checkpoint can be handed straight to a subsequent pull.
 *
 * `categorizationRule` and `savingsGoalContribution` were added in Sprint
 * 13.5: the local domain engine's rule application/testing/bulk-apply and
 * savings goal projection math both need these locally, and neither had
 * ever been added to the sync surface. Both are personal-only (no
 * `workspaceId` field on either model), scoped by `userId` regardless of
 * the caller's active workspace, the same way `tag` already is.
 *
 * `transactionTemplate` was added in Sprint 13.9 alongside the rest of the
 * push surface generalization (syncController.ts's applyOp): the new local
 * TransactionTemplate table needs bootstrap/pull coverage the same way
 * `categorizationRule` does. Personal-only (no `workspaceId` field), scoped
 * by `userId`.
 */
export const SYNC_ENTITIES = [
    'account',
    'transaction',
    'category',
    'budget',
    'savingsGoal',
    'tag',
    'recurringRule',
    'categorizationRule',
    'savingsGoalContribution',
    'transactionTemplate',
] as const
export type SyncEntityName = (typeof SYNC_ENTITIES)[number]

const RESPONSE_FIELD: Record<SyncEntityName, string> = {
    account: 'accounts',
    transaction: 'transactions',
    category: 'categories',
    budget: 'budgets',
    savingsGoal: 'savingsGoals',
    tag: 'tags',
    recurringRule: 'recurringRules',
    categorizationRule: 'categorizationRules',
    savingsGoalContribution: 'savingsGoalContributions',
    transactionTemplate: 'transactionTemplates',
}

interface EntityConfig {
    model: Model<Document>
    hasSoftDelete: boolean
    buildScope: (userId: string, workspaceId: string | null) => Record<string, unknown>
}

const ENTITY_CONFIG: Record<SyncEntityName, EntityConfig> = {
    account: {
        model: Account as unknown as Model<Document>,
        hasSoftDelete: false,
        buildScope: (userId, workspaceId) => buildScopedListFilter(userId, workspaceId),
    },
    transaction: {
        model: Transaction as unknown as Model<Document>,
        hasSoftDelete: true,
        buildScope: (userId, workspaceId) => buildScopedListFilter(userId, workspaceId),
    },
    category: {
        model: Category as unknown as Model<Document>,
        hasSoftDelete: false,
        // User's own categories plus the shared `userId: null` masters. Expressed as a single
        // `userId: { $in: [...] }` rather than a top-level `$or` so it survives being merged
        // with the pull cursor's own `$or` in `combineFilters` — and so the RLS guard sees a
        // top-level `userId` key (an `$or` whose branches carry the scope satisfies the guard
        // alone, but not once it is `$and`-nested under an unscoped cursor clause). See the
        // `Category` note in CLAUDE.md.
        buildScope: (userId) => ({
            userId: { $in: [new Types.ObjectId(userId), null] },
        }),
    },
    budget: {
        model: Budget as unknown as Model<Document>,
        hasSoftDelete: false,
        buildScope: (userId, workspaceId) => buildScopedListFilter(userId, workspaceId),
    },
    savingsGoal: {
        model: SavingsGoal as unknown as Model<Document>,
        hasSoftDelete: false,
        buildScope: (userId, workspaceId) => buildScopedListFilter(userId, workspaceId),
    },
    tag: {
        model: Tag as unknown as Model<Document>,
        hasSoftDelete: true,
        buildScope: (userId) => ({ userId: new Types.ObjectId(userId) }),
    },
    recurringRule: {
        model: RecurringRule as unknown as Model<Document>,
        hasSoftDelete: false,
        buildScope: (userId, workspaceId) => buildScopedListFilter(userId, workspaceId),
    },
    categorizationRule: {
        model: CategorizationRule as unknown as Model<Document>,
        hasSoftDelete: true,
        buildScope: (userId) => ({ userId: new Types.ObjectId(userId) }),
    },
    savingsGoalContribution: {
        model: SavingsGoalContribution as unknown as Model<Document>,
        hasSoftDelete: false,
        buildScope: (userId) => ({ userId: new Types.ObjectId(userId) }),
    },
    transactionTemplate: {
        model: TransactionTemplate as unknown as Model<Document>,
        hasSoftDelete: true,
        buildScope: (userId) => ({ userId: new Types.ObjectId(userId) }),
    },
}

interface SyncCursor {
    updatedAt: string
    id: string
}

type SyncCursorMap = Partial<Record<SyncEntityName, SyncCursor>>

const PULL_LIMIT_DEFAULT = 200
const PULL_LIMIT_MAX = 500

const encodeCheckpoint = (cursors: SyncCursorMap): string =>
    Buffer.from(JSON.stringify({ cursors })).toString('base64url')

const decodeCheckpoint = (checkpoint: string | undefined): SyncCursorMap => {
    if (!checkpoint) {
        return {}
    }
    try {
        const parsed = JSON.parse(Buffer.from(checkpoint, 'base64url').toString('utf8')) as {
            cursors?: SyncCursorMap
        }
        return parsed.cursors ?? {}
    } catch {
        throw new CustomError('Invalid sync checkpoint', 400)
    }
}

const clampPullLimit = (value: unknown): number => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return PULL_LIMIT_DEFAULT
    }
    return Math.min(Math.floor(parsed), PULL_LIMIT_MAX)
}

/** Combines a base scope filter with an optional cursor filter without one $or clobbering the other. */
const combineFilters = (
    scope: Record<string, unknown>,
    cursorFilter: Record<string, unknown> | null
): Record<string, unknown> => {
    if (!cursorFilter) {
        return scope
    }
    if ('$or' in scope) {
        return { $and: [scope, cursorFilter] }
    }
    return { ...scope, ...cursorFilter }
}

const buildCursorFilter = (cursor: SyncCursor | undefined): Record<string, unknown> | null => {
    if (!cursor) {
        return null
    }
    const cursorDate = new Date(cursor.updatedAt)
    return {
        $or: [
            { updatedAt: { $gt: cursorDate } },
            { updatedAt: cursorDate, _id: { $gt: new Types.ObjectId(cursor.id) } },
        ],
    }
}

interface EntityDoc {
    _id: Types.ObjectId
    updatedAt: Date
    deletedAt?: Date | null
    toObject: () => Record<string, unknown>
}

export interface BootstrapSnapshot {
    checkpoint: string
    snapshot: Record<string, unknown[]>
}

export const buildBootstrapSnapshot = async (
    userId: string,
    workspaceId: string | null
): Promise<BootstrapSnapshot> => {
    const cursors: SyncCursorMap = {}
    const snapshot: Record<string, unknown[]> = {}

    for (const entity of SYNC_ENTITIES) {
        const config = ENTITY_CONFIG[entity]
        const scope = config.buildScope(userId, workspaceId)
        const docs = (await config.model
            .find(scope)
            .sort({ updatedAt: 1, _id: 1 })) as unknown as EntityDoc[]

        snapshot[RESPONSE_FIELD[entity]] = docs.map((doc) => doc.toObject())

        if (docs.length > 0) {
            const last = docs[docs.length - 1]
            cursors[entity] = { updatedAt: last.updatedAt.toISOString(), id: last._id.toString() }
        }
    }

    return { checkpoint: encodeCheckpoint(cursors), snapshot }
}

export interface SyncChange {
    entity: SyncEntityName
    doc: Record<string, unknown>
}

export interface SyncTombstone {
    entity: SyncEntityName
    _id: string
    deletedAt: string
}

export interface PullPage {
    changes: SyncChange[]
    tombstones: SyncTombstone[]
    checkpoint: string
    hasMore: boolean
}

export const buildPullPage = async (
    userId: string,
    workspaceId: string | null,
    checkpoint: string | undefined,
    limitParam: unknown
): Promise<PullPage> => {
    const cursors = decodeCheckpoint(checkpoint)
    let remaining = clampPullLimit(limitParam)
    let hasMore = false

    const changes: SyncChange[] = []
    const tombstones: SyncTombstone[] = []
    const nextCursors: SyncCursorMap = { ...cursors }

    for (const entity of SYNC_ENTITIES) {
        if (remaining <= 0) {
            hasMore = true
            continue
        }

        const config = ENTITY_CONFIG[entity]
        const scope = config.buildScope(userId, workspaceId)
        const cursorFilter = buildCursorFilter(cursors[entity])
        const filter = combineFilters(scope, cursorFilter)

        let query = config.model.find(filter).sort({ updatedAt: 1, _id: 1 }).limit(remaining + 1)
        if (config.hasSoftDelete) {
            query = query.setOptions({ [SOFT_DELETE_BYPASS]: true })
        }
        const docs = (await query) as unknown as EntityDoc[]

        const page = docs.slice(0, remaining)
        const hasExtra = docs.length > page.length

        for (const doc of page) {
            const plain = doc.toObject()
            if (config.hasSoftDelete && doc.deletedAt) {
                tombstones.push({
                    entity,
                    _id: doc._id.toString(),
                    deletedAt: doc.deletedAt.toISOString(),
                })
            } else {
                changes.push({ entity, doc: plain })
            }
        }

        remaining -= page.length

        if (page.length > 0) {
            const last = page[page.length - 1]
            nextCursors[entity] = { updatedAt: last.updatedAt.toISOString(), id: last._id.toString() }
        }

        if (hasExtra) {
            hasMore = true
        }
    }

    return { changes, tombstones, checkpoint: encodeCheckpoint(nextCursors), hasMore }
}

/**
 * A fresh checkpoint reflecting the caller's current personal-scope state,
 * returned alongside POST /sync/push results. Callers resume pulling from
 * here; the exact cursor values only need to be internally consistent with
 * buildPullPage's format, not tied to any specific op in the push batch.
 */
export const computeCurrentCheckpoint = async (
    userId: string,
    workspaceId: string | null
): Promise<string> => {
    const cursors: SyncCursorMap = {}

    for (const entity of SYNC_ENTITIES) {
        const config = ENTITY_CONFIG[entity]
        const scope = config.buildScope(userId, workspaceId)
        let query = config.model.find(scope).sort({ updatedAt: -1, _id: -1 }).limit(1)
        if (config.hasSoftDelete) {
            query = query.setOptions({ [SOFT_DELETE_BYPASS]: true })
        }
        const [doc] = (await query) as unknown as EntityDoc[]
        if (doc) {
            cursors[entity] = { updatedAt: doc.updatedAt.toISOString(), id: doc._id.toString() }
        }
    }

    return encodeCheckpoint(cursors)
}
