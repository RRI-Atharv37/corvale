import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Document, Model, Types } from 'mongoose'

import { AuthRequest } from '@http/middleware/authTypes'
import { Account } from '@modules/accounts'
import { Budget } from '@modules/budgets'
import { Category } from '@modules/categories'
import { CategorizationRule } from '@modules/categorization-rules'
import { RecurringRule } from '@modules/recurring'
import { SavingsGoal } from '@modules/savings-goals'
import { Tag } from '@modules/tags'
import { ITransaction, Transaction } from '@modules/transactions'
import { TransactionTemplate } from '@modules/transaction-templates'
import SyncOperation, { SyncOpStatus } from './syncOperation.model'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    buildBootstrapSnapshot,
    buildPullPage,
    computeCurrentCheckpoint,
} from './sync.service'
import { createAccountForOp, deleteAccountForOp, updateAccountForOp } from './accountSync.service'
import {
    createCategoryForOp,
    deleteCategoryForOp,
    updateCategoryForOp,
    validateUserCategoryForOp,
} from './categorySync.service'
import { createBudgetForOp, deleteBudgetForOp, updateBudgetForOp } from './budgetSync.service'
import {
    createSavingsGoalForOp,
    deleteSavingsGoalForOp,
    updateSavingsGoalForOp,
} from './savingsGoalSync.service'
import { createTagForOp, deleteTagForOp, updateTagForOp } from './tagSync.service'
import {
    createRecurringRuleForOp,
    deleteRecurringRuleForOp,
    updateRecurringRuleForOp,
} from './recurringRuleSync.service'
import {
    createCategorizationRuleForOp,
    deleteCategorizationRuleForOp,
    updateCategorizationRuleForOp,
} from './categorizationRuleSync.service'
import {
    createTransactionTemplateForOp,
    deleteTransactionTemplateForOp,
    updateTransactionTemplateForOp,
} from './transactionTemplateSync.service'
import { fromMinorUnits } from '@shared/money'
import { serializeAccountDocForWire } from '@core/money/accountWireFormat'
import { SOFT_DELETE_BYPASS } from '@core/softDelete/softDelete'
import { parseOptionalWorkspaceId } from '@core/access/workspace'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { isDuplicateKeyError } from '@core/db/objectId'
import { validateRequiredFields } from '@core/http/validation'
import { createTransactionForUser, createTransferForOp, deleteTransactionForOp, updateTransactionForOp } from "@modules/transactions/transaction.service";
import { assertWorkspaceMembership } from "@modules/workspaces/access";

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
    | { status: 'id_conflict'; resultId: null }

interface OwnableDoc {
    userId: Types.ObjectId | null
    workspaceId?: Types.ObjectId | null
    deletedAt?: Date | null
}

/**
 * Whether an existing document a create op's client-generated `_id`
 * collided with belongs to the calling user (SEC-13, BUG-02). A workspace
 * doc is "owned" by any member; a `userId: null` doc (the master-category
 * concept) is shared and never a conflict; otherwise the doc's `userId`
 * must match the caller.
 */
const isOwnedByCaller = async (existing: OwnableDoc, userId: string): Promise<boolean> => {
    if (existing.workspaceId) {
        try {
            await assertWorkspaceMembership(existing.workspaceId.toString(), userId, 'viewer')
            return true
        } catch {
            return false
        }
    }
    if (existing.userId === null) {
        return true
    }
    return existing.userId.toString() === userId
}

const applyCreateOp = async (userId: string, payload: Record<string, unknown>): Promise<ApplyOpOutcome> => {
    const clientId = payload._id
    if (typeof clientId === 'string' && Types.ObjectId.isValid(clientId)) {
        // SEC-55: bypass the soft-delete filter (see applyGenericCreate) so a collision with a
        // tombstoned row is caught here as an id_conflict, not missed into a duplicate-key insert.
        const existing = await Transaction.findById(clientId).setOptions({
            [SOFT_DELETE_BYPASS]: true,
        })
        if (existing) {
            if (existing.deletedAt != null || !(await isOwnedByCaller(existing, userId))) {
                return { status: 'id_conflict', resultId: null }
            }
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

/**
 * BUG-16: the staleness checks in this file compare `baseUpdatedAt` against the
 * server doc's `updatedAt` as an exact ISO string, which is only
 * millisecond-resolution. Two writes to one document inside the same millisecond
 * (a second sync op, or a genuine two-device race) leave `updatedAt` byte-identical,
 * so the second op's "did this change out from under me?" check passes when it
 * should report a conflict — a silent lost update.
 *
 * This wraps the entity's apply logic with an atomic compare-and-set on
 * `updatedAt`: exactly one of N racers can move the row off `current.updatedAt`
 * (the rest come back `conflict`), and the row is then guaranteed to land strictly
 * past that value even when the wall clock did not advance across the apply. The
 * `{ _id, userId, updatedAt }` filter keeps the RLS guard satisfied (it has a
 * `userId` key) and `timestamps: false` stops Mongoose from clobbering the `$set`.
 *
 * If `updateForOp` throws after the claim (a malformed payload that passed client
 * validation), `updatedAt` is left advanced with no content change and peers
 * re-pull an identical doc once — accepted over the complexity of a rollback.
 */
const applyUpdateWithConcurrencyGuard = async <
    T extends { _id: Types.ObjectId; userId: Types.ObjectId | null; updatedAt: Date }
>(
    model: Model<T>,
    current: T,
    updateForOp: () => Promise<{ _id: Types.ObjectId; updatedAt: Date }>,
    serializeConflictDoc: (doc: T) => Record<string, unknown>
): Promise<ApplyOpOutcome> => {
    const bumpedAt = new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1))

    const claim = await model.updateOne(
        { _id: current._id, userId: current.userId, updatedAt: current.updatedAt },
        { $set: { updatedAt: bumpedAt } },
        { timestamps: false }
    )
    if (claim.matchedCount === 0) {
        const fresh = (await model
            .findById(current._id)
            .setOptions({ [SOFT_DELETE_BYPASS]: true })) as T | null
        return {
            status: 'conflict',
            resultId: current._id.toString(),
            conflict: { serverDoc: serializeConflictDoc(fresh ?? current) },
        }
    }

    const updated = await updateForOp()

    if (updated.updatedAt.getTime() < bumpedAt.getTime()) {
        await model.updateOne(
            { _id: updated._id, userId: current.userId, updatedAt: updated.updatedAt },
            { $set: { updatedAt: bumpedAt } },
            { timestamps: false }
        )
    }

    return { status: 'applied', resultId: updated._id.toString() }
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

    return applyUpdateWithConcurrencyGuard(
        Transaction,
        current,
        () => updateTransactionForOp(userId, payload),
        (doc) => doc.toObject() as unknown as Record<string, unknown>
    )
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
 * concept), so it's excluded from this constraint (`EntityDoc.userId` is
 * non-null) and only ever goes through applyGenericCreate — whose ownership
 * check (`OwnableDoc`, SEC-13) tolerates a null `userId` as a shared/master
 * resource — plus its own bespoke applyCategoryUpdateOp, never
 * fetchCurrentGeneric/applyGenericUpdate, which assume a real owner.
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

const applyGenericCreate = async <T extends MinimalSyncDoc & OwnableDoc>(
    model: Model<T>,
    userId: string,
    payload: Record<string, unknown>,
    createForOp: () => Promise<{ _id: Types.ObjectId }>
): Promise<ApplyOpOutcome> => {
    const clientId = payload._id
    if (typeof clientId === 'string' && Types.ObjectId.isValid(clientId)) {
        // SEC-55: bypass the soft-delete filter so a client id colliding with a *tombstoned* row
        // (another user's, or the caller's own deleted one) is caught here rather than slipping
        // past `isOwnedByCaller` into a duplicate-key insert. A create can never bind to a
        // tombstone — the row is gone — so the client must regenerate its id.
        const existing = await model.findById(clientId).setOptions({ [SOFT_DELETE_BYPASS]: true })
        if (existing) {
            if (existing.deletedAt != null || !(await isOwnedByCaller(existing, userId))) {
                return { status: 'id_conflict', resultId: null }
            }
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
    updateForOp: () => Promise<{ _id: Types.ObjectId; updatedAt: Date }>,
    // Defaults to the raw document. `account` overrides it so a conflict's
    // serverDoc carries major-unit balances, matching the bootstrap/pull wire
    // format (accountWireFormat.ts / BUG-17) — `keep-server` conflict
    // resolution ingests this doc verbatim.
    serializeConflictDoc: (doc: T) => Record<string, unknown> = (doc) =>
        doc.toObject() as unknown as Record<string, unknown>
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
            conflict: { serverDoc: serializeConflictDoc(current) },
        }
    }

    return applyUpdateWithConcurrencyGuard(model, current, updateForOp, serializeConflictDoc)
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

    return applyUpdateWithConcurrencyGuard(
        Category,
        current,
        () => updateCategoryForOp(userId, payload),
        (doc) => doc.toObject() as unknown as Record<string, unknown>
    )
}

const categoryHandlers: EntityOpHandlers = {
    create: (userId, payload) =>
        applyGenericCreate(Category, userId, payload, () => createCategoryForOp(userId, payload)),
    update: applyCategoryUpdateOp,
    delete: (userId, payload) => deleteCategoryForOp(userId, payload),
}

const ENTITY_HANDLERS: Record<string, EntityOpHandlers> = {
    account: {
        create: (userId, payload) =>
            applyGenericCreate(Account, userId, payload, () => createAccountForOp(userId, payload)),
        update: (userId, payload, baseUpdatedAt) =>
            applyGenericUpdate(
                Account,
                userId,
                payload,
                baseUpdatedAt,
                ERROR_MESSAGES.ACCOUNT.ACCOUNT_NOT_FOUND,
                false,
                () => updateAccountForOp(userId, payload),
                (doc) => serializeAccountDocForWire(doc.toObject() as unknown as Record<string, unknown>)
            ),
        delete: (userId, payload) => deleteAccountForOp(userId, payload),
    },
    category: categoryHandlers,
    budget: {
        create: (userId, payload) =>
            applyGenericCreate(Budget, userId, payload, () => createBudgetForOp(userId, payload)),
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
            applyGenericCreate(SavingsGoal, userId, payload, () => createSavingsGoalForOp(userId, payload)),
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
        create: (userId, payload) => applyGenericCreate(Tag, userId, payload, () => createTagForOp(userId, payload)),
        update: (userId, payload, baseUpdatedAt) =>
            applyGenericUpdate(Tag, userId, payload, baseUpdatedAt, ERROR_MESSAGES.TAG.TAG_NOT_FOUND, true, () =>
                updateTagForOp(userId, payload)
            ),
        delete: (userId, payload) => deleteTagForOp(userId, payload),
    },
    recurringRule: {
        create: (userId, payload) =>
            applyGenericCreate(RecurringRule, userId, payload, () => createRecurringRuleForOp(userId, payload)),
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
            applyGenericCreate(CategorizationRule, userId, payload, () =>
                createCategorizationRuleForOp(userId, payload)
            ),
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
            applyGenericCreate(TransactionTemplate, userId, payload, () =>
                createTransactionTemplateForOp(userId, payload)
            ),
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
 * Per-document last-write-wins with delete-always-wins (the "Conflicts" architecture
 * decision): delete never precondition-checks against baseUpdatedAt —
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const PENDING_CLAIM_POLL_INTERVAL_MS = 15
const PENDING_CLAIM_POLL_TIMEOUT_MS = 2000

type ClaimResult =
    | { claimed: true }
    | { claimed: false; status: SyncOpStatus; resultId: string | null }

/**
 * The unique (userId, opId) index is the mutex for BUG-10: this inserts a
 * `pending` row *before* the op is applied, so two requests racing on the
 * same opId can't both pass a read-then-write idempotency check. The loser's
 * insert fails with a duplicate-key error; it then waits on the winner's
 * pending row to resolve (or, if a prior attempt crashed mid-apply and left
 * a stale pending row past the poll deadline, reports the op as not yet
 * resolved rather than re-applying it).
 */
const claimSyncOperation = async (
    userId: string,
    op: SyncOpInput
): Promise<ClaimResult> => {
    try {
        await SyncOperation.create({
            userId,
            opId: op.opId,
            entity: op.entity,
            operation: op.operation,
            status: 'pending',
            resultId: null,
        })
        return { claimed: true }
    } catch (error) {
        if (!isDuplicateKeyError(error)) {
            throw error
        }
    }

    const deadline = Date.now() + PENDING_CLAIM_POLL_TIMEOUT_MS
    let existing = await SyncOperation.findOne({ userId, opId: op.opId })

    while (existing && existing.status === 'pending' && Date.now() < deadline) {
        await sleep(PENDING_CLAIM_POLL_INTERVAL_MS)
        existing = await SyncOperation.findOne({ userId, opId: op.opId })
    }

    if (!existing || existing.status === 'pending') {
        return { claimed: false, status: 'rejected', resultId: null }
    }

    return { claimed: false, status: existing.status, resultId: existing.resultId ?? null }
}

export const pushSyncOps = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const ops = req.body?.ops

    if (!Array.isArray(ops) || ops.length === 0) {
        throw new CustomError('ops must be a non-empty array', 400)
    }
    if (ops.length > MAX_PUSH_OPS) {
        throw new CustomError(`Push payload exceeds the maximum of ${MAX_PUSH_OPS} operations`, 413)
    }

    const workspaceId = parseOptionalWorkspaceId(req.body?.workspaceId) ?? null
    if (workspaceId) {
        await assertWorkspaceReadable(workspaceId, userId)
    }

    const results: SyncOpResult[] = []

    for (const rawOp of ops as SyncOpInput[]) {
        validateRequiredFields(rawOp as unknown as Record<string, unknown>, [
            'opId',
            'entity',
            'operation',
        ])

        const claim = await claimSyncOperation(userId, rawOp)
        if (!claim.claimed) {
            results.push({ opId: rawOp.opId, status: claim.status, resultId: claim.resultId })
            continue
        }

        try {
            const outcome = await applyOp(userId, rawOp)

            // Only durable outcomes are recorded for idempotency. A conflict
            // reflects "not applied against current state" — replaying it
            // should re-evaluate against whatever the server looks like by
            // then, not return a stale cached conflict. Same for
            // id_conflict: a client that regenerates its local id and
            // retries must be re-evaluated fresh, not short-circuited by a
            // cached collision result.
            if (outcome.status === 'applied' || outcome.status === 'noop') {
                await SyncOperation.updateOne(
                    { userId, opId: rawOp.opId },
                    { $set: { status: outcome.status, resultId: outcome.resultId } }
                )
            } else {
                await SyncOperation.deleteOne({ userId, opId: rawOp.opId })
            }

            results.push({
                opId: rawOp.opId,
                status: outcome.status,
                resultId: outcome.resultId,
                ...(outcome.status === 'conflict' ? { conflict: outcome.conflict } : {}),
            })
        } catch (error) {
            await SyncOperation.deleteOne({ userId, opId: rawOp.opId })
            const message = error instanceof CustomError ? error.message : 'Failed to apply sync operation'
            results.push({ opId: rawOp.opId, status: 'rejected', resultId: null, message })
        }
    }

    const checkpoint = await computeCurrentCheckpoint(userId, workspaceId)
    handleResponses(res, 200, { results, checkpoint })
})
