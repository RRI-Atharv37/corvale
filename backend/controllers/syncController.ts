import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Document, Model, Types } from 'mongoose'

import { AuthRequest } from '../middleware/authTypes'
import Account from '../models/Account'
import Budget from '../models/Budget'
import Category from '../models/Category'
import CategorizationRule from '../models/CategorizationRule'
import RecurringRule from '../models/RecurringRule'
import SavingsGoal from '../models/SavingsGoal'
import Tag from '../models/Tag'
import Transaction, { ITransaction } from '../models/Transaction'
import TransactionTemplate from '../models/TransactionTemplate'
import SyncOperation, { SyncOpStatus } from '../models/SyncOperation'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { getUserId, handleResponses, validateRequiredFields } from '../utils/sharedUtils'
import {
    createTransactionForUser,
    createTransferForOp,
    deleteTransactionForOp,
    updateTransactionForOp,
} from '../services/transactionService'
import {
    buildBootstrapSnapshot,
    buildPullPage,
    computeCurrentCheckpoint,
} from '../services/syncService'
import { createAccountForOp, deleteAccountForOp, updateAccountForOp } from '../services/accountSyncService'
import {
    createCategoryForOp,
    deleteCategoryForOp,
    updateCategoryForOp,
    validateUserCategoryForOp,
} from '../services/categorySyncService'
import { createBudgetForOp, deleteBudgetForOp, updateBudgetForOp } from '../services/budgetSyncService'
import {
    createSavingsGoalForOp,
    deleteSavingsGoalForOp,
    updateSavingsGoalForOp,
} from '../services/savingsGoalSyncService'
import { createTagForOp, deleteTagForOp, updateTagForOp } from '../services/tagSyncService'
import {
    createRecurringRuleForOp,
    deleteRecurringRuleForOp,
    updateRecurringRuleForOp,
} from '../services/recurringRuleSyncService'
import {
    createCategorizationRuleForOp,
    deleteCategorizationRuleForOp,
    updateCategorizationRuleForOp,
} from '../services/categorizationRuleSyncService'
import {
    createTransactionTemplateForOp,
    deleteTransactionTemplateForOp,
    updateTransactionTemplateForOp,
} from '../services/transactionTemplateSyncService'
import { fromMinorUnits } from '../../shared/src/money'
import { SOFT_DELETE_BYPASS } from '../utils/softDelete'
import { assertWorkspaceMembership, parseOptionalWorkspaceId } from '../utils/workspaceUtils'

const MAX_PUSH_OPS = 500

interface SyncOpInput {
    opId: string
    entity: string
    operation: 'create' | 'update' | 'delete'
    baseUpdatedAt?: string
    payload?: Record<string, unknown>
}

interface SyncOpConflict {
    serverDoc: Record<string, unknown>
}

interface SyncOpResult {
    opId: string
    status: SyncOpStatus
    resultId: string | null
    conflict?: SyncOpConflict
    message?: string
}

type ApplyOpOutcome =
    | { status: 'applied'; resultId: string | null }
    | { status: 'noop'; resultId: string | null }
    | { status: 'conflict'; resultId: string | null; conflict: SyncOpConflict }

const applyCreateOp = async (userId: string, payload: Record<string, unknown>): Promise<ApplyOpOutcome> => {
    const clientId = payload._id
    if (typeof clientId === 'string' && Types.ObjectId.isValid(clientId)) {
        const existing = await Transaction.findById(clientId)
        if (existing) {
            return { status: 'noop', resultId: existing._id.toString() }
        }
    }

    if (payload.intent === 'transaction.transfer') {
        const resultId = await createTransferForOp(userId, payload)
        return { status: 'applied', resultId }
    }

    // Sync payloads carry `amount` in minor units (mirroring the local
    // SQLite/Transaction schema), whereas createTransactionForUser expects
    // the REST endpoint's major-unit decimal convention.
    const transactionPayload = {
        ...payload,
        amount: typeof payload.amount === 'number' ? fromMinorUnits(payload.amount) : payload.amount,
    }
    const created = await createTransactionForUser(userId, transactionPayload)
    return { status: 'applied', resultId: created._id.toString() }
}

/**
 * Fetches the current doc bypassing the soft-delete filter, so a doc that
 * was deleted out from under this op is visible as a conflict (deletedAt
 * set) rather than surfacing as a plain 404 — a delete racing an update
 * must resolve to "delete won", not "not found".
 */
const fetchCurrentForConflictCheck = async (
    userId: string,
    transactionId: string
): Promise<ITransaction> => {
    const current = await Transaction.findById(transactionId).setOptions({
        [SOFT_DELETE_BYPASS]: true,
    })
    if (!current) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND, 404)
    }

    if (current.workspaceId) {
        await assertWorkspaceMembership(current.workspaceId.toString(), userId, 'editor')
    } else if (current.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    return current
}

const applyUpdateOp = async (
    userId: string,
    payload: Record<string, unknown>,
    baseUpdatedAt: string | undefined
): Promise<ApplyOpOutcome> => {
    const transactionId = payload._id
    if (typeof transactionId !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

    const current = await fetchCurrentForConflictCheck(userId, transactionId)

    const isStale = current.deletedAt != null || (baseUpdatedAt !== undefined && current.updatedAt.toISOString() !== baseUpdatedAt)
    if (isStale) {
        return {
            status: 'conflict',
            resultId: current._id.toString(),
            conflict: { serverDoc: current.toObject() },
        }
    }

    const updated = await updateTransactionForOp(userId, payload)
    return { status: 'applied', resultId: updated._id.toString() }
}

// ---------------------------------------------------------------------------
// Sprint 13.9: generic dispatch for every non-transaction sync entity.
//
// account/budget/savingsGoal/recurringRule/tag/categorizationRule/
// transactionTemplate all share the same two shapes of conflict-checking
// that transaction already established above:
//   - create: a client-generated `_id` that already exists is a no-op.
//   - update: fetch + workspace-or-owner check + staleness check (stale =
//     tombstoned for the soft-delete entities, or baseUpdatedAt mismatch)
//     before ever calling the entity's own field-validation/apply logic.
// `category` is handled separately below (validateUserCategoryForOp) since
// it has a `userId: null` master-category concept the generic owner check
// would crash on.
// ---------------------------------------------------------------------------

interface MinimalSyncDoc extends Document {
    _id: Types.ObjectId
}

/**
 * `category` is the one model with a nullable `userId` (the master-category
 * concept), so it's excluded from this constraint and only ever goes
 * through applyGenericCreate (which doesn't need ownership fields) plus its
 * own bespoke applyCategoryUpdateOp — never fetchCurrentGeneric/
 * applyGenericUpdate, which assume a real owner.
 */
interface EntityDoc extends MinimalSyncDoc {
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
    updatedAt: Date
    deletedAt?: Date | null
}

/** `deletedAt` is always undefined on archive-flag entities, so this is a no-op for them. */
const isStaleGeneric = (current: EntityDoc, baseUpdatedAt: string | undefined): boolean =>
    current.deletedAt != null || (baseUpdatedAt !== undefined && current.updatedAt.toISOString() !== baseUpdatedAt)

const applyGenericCreate = async <T extends MinimalSyncDoc>(
    model: Model<T>,
    payload: Record<string, unknown>,
    createForOp: () => Promise<{ _id: Types.ObjectId }>
): Promise<ApplyOpOutcome> => {
    const clientId = payload._id
    if (typeof clientId === 'string' && Types.ObjectId.isValid(clientId)) {
        const existing = await model.findById(clientId)
        if (existing) {
            return { status: 'noop', resultId: existing._id.toString() }
        }
    }

    const created = await createForOp()
    return { status: 'applied', resultId: created._id.toString() }
}

/**
 * Generalizes fetchCurrentForConflictCheck + applyUpdateOp's staleness check
 * across every entity model. Fetch/staleness logic is inlined here (rather
 * than delegated to a second generic Model<T>-typed helper) because
 * Mongoose's Model<T> isn't structurally covariant enough for TS to unify
 * two independently-generic functions both parameterized over Model<T> —
 * composing them across a function boundary breaks inference even though
 * each one type-checks fine on its own.
 */
const applyGenericUpdate = async <T extends EntityDoc>(
    model: Model<T>,
    userId: string,
    payload: Record<string, unknown>,
    baseUpdatedAt: string | undefined,
    notFoundMessage: string,
    hasSoftDelete: boolean,
    updateForOp: () => Promise<{ _id: Types.ObjectId }>
): Promise<ApplyOpOutcome> => {
    const id = payload._id
    if (typeof id !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

    let query = model.findById(id)
    if (hasSoftDelete) {
        query = query.setOptions({ [SOFT_DELETE_BYPASS]: true })
    }
    const current = await query
    if (!current) {
        throw new CustomError(notFoundMessage, 404)
    }

    if (current.workspaceId) {
        await assertWorkspaceMembership(current.workspaceId.toString(), userId, 'editor')
    } else if (current.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    if (isStaleGeneric(current, baseUpdatedAt)) {
        return {
            status: 'conflict',
            resultId: current._id.toString(),
            conflict: { serverDoc: current.toObject() as unknown as Record<string, unknown> },
        }
    }

    const updated = await updateForOp()
    return { status: 'applied', resultId: updated._id.toString() }
}

interface EntityOpHandlers {
    create: (userId: string, payload: Record<string, unknown>) => Promise<ApplyOpOutcome>
    update: (
        userId: string,
        payload: Record<string, unknown>,
        baseUpdatedAt: string | undefined
    ) => Promise<ApplyOpOutcome>
    delete: (userId: string, payload: Record<string, unknown>) => Promise<ApplyOpOutcome>
}

/**
 * `category` can't reuse fetchCurrentGeneric's plain-userId-ownership
 * fallback: master categories have `userId: null`, and a sync op that
 * targets one must be rejected with CANNOT_MODIFY_MASTER (mirroring
 * categoryController's validateUserCategory) rather than crash on
 * `null.toString()`.
 */
const applyCategoryUpdateOp = async (
    userId: string,
    payload: Record<string, unknown>,
    baseUpdatedAt: string | undefined
): Promise<ApplyOpOutcome> => {
    const id = payload._id
    if (typeof id !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

    const current = await validateUserCategoryForOp(id, userId)
    const isStale = baseUpdatedAt !== undefined && current.updatedAt.toISOString() !== baseUpdatedAt
    if (isStale) {
        return {
            status: 'conflict',
            resultId: current._id.toString(),
            conflict: { serverDoc: current.toObject() },
        }
    }

    const updated = await updateCategoryForOp(userId, payload)
    return { status: 'applied', resultId: updated._id.toString() }
}

const categoryHandlers: EntityOpHandlers = {
    create: (userId, payload) => applyGenericCreate(Category, payload, () => createCategoryForOp(userId, payload)),
    update: applyCategoryUpdateOp,
    delete: (userId, payload) => deleteCategoryForOp(userId, payload),
}

const ENTITY_HANDLERS: Record<string, EntityOpHandlers> = {
    account: {
        create: (userId, payload) => applyGenericCreate(Account, payload, () => createAccountForOp(userId, payload)),
        update: (userId, payload, baseUpdatedAt) =>
            applyGenericUpdate(
                Account,
                userId,
                payload,
                baseUpdatedAt,
                ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
                false,
                () => updateAccountForOp(userId, payload)
            ),
        delete: (userId, payload) => deleteAccountForOp(userId, payload),
    },
    category: categoryHandlers,
    budget: {
        create: (userId, payload) => applyGenericCreate(Budget, payload, () => createBudgetForOp(userId, payload)),
        update: (userId, payload, baseUpdatedAt) =>
            applyGenericUpdate(
                Budget,
                userId,
                payload,
                baseUpdatedAt,
                ERROR_MESSAGES.BUDGET.BUDGET_NOT_FOUND,
                false,
                () => updateBudgetForOp(userId, payload)
            ),
        delete: (userId, payload) => deleteBudgetForOp(userId, payload),
    },
    savingsGoal: {
        create: (userId, payload) =>
            applyGenericCreate(SavingsGoal, payload, () => createSavingsGoalForOp(userId, payload)),
        update: (userId, payload, baseUpdatedAt) =>
            applyGenericUpdate(
                SavingsGoal,
                userId,
                payload,
                baseUpdatedAt,
                ERROR_MESSAGES.SAVINGS_GOAL.GOAL_NOT_FOUND,
                false,
                () => updateSavingsGoalForOp(userId, payload)
            ),
        delete: (userId, payload) => deleteSavingsGoalForOp(userId, payload),
    },
    tag: {
        create: (userId, payload) => applyGenericCreate(Tag, payload, () => createTagForOp(userId, payload)),
        update: (userId, payload, baseUpdatedAt) =>
            applyGenericUpdate(Tag, userId, payload, baseUpdatedAt, ERROR_MESSAGES.TAG.TAG_NOT_FOUND, true, () =>
                updateTagForOp(userId, payload)
            ),
        delete: (userId, payload) => deleteTagForOp(userId, payload),
    },
    recurringRule: {
        create: (userId, payload) =>
            applyGenericCreate(RecurringRule, payload, () => createRecurringRuleForOp(userId, payload)),
        update: (userId, payload, baseUpdatedAt) =>
            applyGenericUpdate(
                RecurringRule,
                userId,
                payload,
                baseUpdatedAt,
                ERROR_MESSAGES.RECURRING.RULE_NOT_FOUND,
                false,
                () => updateRecurringRuleForOp(userId, payload)
            ),
        delete: (userId, payload) => deleteRecurringRuleForOp(userId, payload),
    },
    categorizationRule: {
        create: (userId, payload) =>
            applyGenericCreate(CategorizationRule, payload, () => createCategorizationRuleForOp(userId, payload)),
        update: (userId, payload, baseUpdatedAt) =>
            applyGenericUpdate(
                CategorizationRule,
                userId,
                payload,
                baseUpdatedAt,
                ERROR_MESSAGES.CATEGORIZATION_RULE.RULE_NOT_FOUND,
                true,
                () => updateCategorizationRuleForOp(userId, payload)
            ),
        delete: (userId, payload) => deleteCategorizationRuleForOp(userId, payload),
    },
    transactionTemplate: {
        create: (userId, payload) =>
            applyGenericCreate(TransactionTemplate, payload, () => createTransactionTemplateForOp(userId, payload)),
        update: (userId, payload, baseUpdatedAt) =>
            applyGenericUpdate(
                TransactionTemplate,
                userId,
                payload,
                baseUpdatedAt,
                ERROR_MESSAGES.TRANSACTION_TEMPLATE.TEMPLATE_NOT_FOUND,
                true,
                () => updateTransactionTemplateForOp(userId, payload)
            ),
        delete: (userId, payload) => deleteTransactionTemplateForOp(userId, payload),
    },
}

/**
 * Per-document last-write-wins with delete-always-wins (ROADMAP.md
 * "Conflicts"): delete never precondition-checks against baseUpdatedAt —
 * it tombstones unconditionally — while update always enforces it when
 * provided. That combination is what makes a racing update+delete in the
 * same push resolve to "deleted", regardless of which op runs first.
 *
 * `transaction` keeps its own hand-written branch (untouched from before
 * Sprint 13.9); every other known entity dispatches through
 * ENTITY_HANDLERS. A genuinely unknown entity string (not in SYNC_ENTITIES
 * at all) still falls through to the "Unsupported sync entity" error.
 */
const applyOp = async (userId: string, op: SyncOpInput): Promise<ApplyOpOutcome> => {
    const payload = op.payload ?? {}

    if (op.entity === 'transaction') {
        if (op.operation === 'create') {
            return applyCreateOp(userId, payload)
        }
        if (op.operation === 'update') {
            return applyUpdateOp(userId, payload, op.baseUpdatedAt)
        }
        const resultId = await deleteTransactionForOp(userId, payload)
        return { status: 'applied', resultId }
    }

    const handlers = ENTITY_HANDLERS[op.entity]
    if (!handlers) {
        throw new CustomError(`Unsupported sync entity: ${op.entity}`, 400)
    }

    if (op.operation === 'create') {
        return handlers.create(userId, payload)
    }
    if (op.operation === 'update') {
        return handlers.update(userId, payload, op.baseUpdatedAt)
    }
    return handlers.delete(userId, payload)
}

/**
 * Sync endpoints don't distinguish "workspace doesn't exist" from "you're
 * not a member" — both collapse to 403 so a caller can't probe for the
 * existence of workspaces they don't belong to.
 */
const assertWorkspaceReadable = async (workspaceId: string, userId: string): Promise<void> => {
    try {
        await assertWorkspaceMembership(workspaceId, userId, 'viewer')
    } catch (error) {
        if (error instanceof CustomError && error.statusCode === 404) {
            throw new CustomError(ERROR_MESSAGES.WORKSPACE.NOT_A_MEMBER, 403)
        }
        throw error
    }
}

export const getSyncBootstrap = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const workspaceId = parseOptionalWorkspaceId(req.query.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceReadable(workspaceId, userId)
    }

    const { checkpoint, snapshot } = await buildBootstrapSnapshot(userId, workspaceId)
    handleResponses(res, 200, { checkpoint, ...snapshot })
})

export const getSyncPull = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const workspaceId = parseOptionalWorkspaceId(req.query.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceReadable(workspaceId, userId)
    }

    const page = await buildPullPage(
        userId,
        workspaceId,
        typeof req.query.checkpoint === 'string' ? req.query.checkpoint : undefined,
        req.query.limit
    )
    handleResponses(res, 200, page)
})

export const pushSyncOps = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const ops = req.body?.ops

    if (!Array.isArray(ops) || ops.length === 0) {
        throw new CustomError('ops must be a non-empty array', 400)
    }
    if (ops.length > MAX_PUSH_OPS) {
        throw new CustomError(`Push payload exceeds the maximum of ${MAX_PUSH_OPS} operations`, 413)
    }

    const results: SyncOpResult[] = []

    for (const rawOp of ops as SyncOpInput[]) {
        validateRequiredFields(rawOp as unknown as Record<string, unknown>, [
            'opId',
            'entity',
            'operation',
        ])

        const existing = await SyncOperation.findOne({ userId, opId: rawOp.opId })
        if (existing) {
            results.push({
                opId: rawOp.opId,
                status: existing.status,
                resultId: existing.resultId ?? null,
            })
            continue
        }

        try {
            const outcome = await applyOp(userId, rawOp)

            // Only durable outcomes are recorded for idempotency. A conflict
            // reflects "not applied against current state" — replaying it
            // should re-evaluate against whatever the server looks like by
            // then, not return a stale cached conflict.
            if (outcome.status === 'applied' || outcome.status === 'noop') {
                await SyncOperation.create({
                    userId,
                    opId: rawOp.opId,
                    entity: rawOp.entity,
                    operation: rawOp.operation,
                    status: outcome.status,
                    resultId: outcome.resultId,
                })
            }

            results.push({
                opId: rawOp.opId,
                status: outcome.status,
                resultId: outcome.resultId,
                ...(outcome.status === 'conflict' ? { conflict: outcome.conflict } : {}),
            })
        } catch (error) {
            const message = error instanceof CustomError ? error.message : 'Failed to apply sync operation'
            results.push({ opId: rawOp.opId, status: 'rejected', resultId: null, message })
        }
    }

    const checkpoint = await computeCurrentCheckpoint(userId, null)
    handleResponses(res, 200, { results, checkpoint })
})
