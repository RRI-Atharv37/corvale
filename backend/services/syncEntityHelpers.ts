import { Document, Model, Types } from 'mongoose'

import User from '../models/User'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { SOFT_DELETE_BYPASS } from '@core/softDelete/softDelete'
import { DEFAULT_TIMEZONE } from '@core/time/timezoneUtils'
import { assertWorkspaceMembership } from '@core/access/workspace'

/**
 * Sprint 13.9: shared "delete" mechanics for the non-transaction sync
 * entities, used by each `<entity>SyncService.ts`'s `delete<Entity>ForOp`.
 * syncController.ts's conflict/staleness checking (mirroring
 * fetchCurrentForConflictCheck/applyUpdateOp) stays entity-generic there
 * since it needs the ApplyOpOutcome union type; only the two "what does
 * delete actually do to this doc" shapes are factored out here.
 */
export interface EntityDoc extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
}

export type DeleteOpOutcome =
    | { status: 'applied'; resultId: string }
    | { status: 'noop'; resultId: string }

/**
 * Fetch-plus-ownership-check, inlined identically into both helpers below
 * rather than factored into a third shared generic function: Mongoose's
 * Model<T> isn't structurally covariant enough for TS to unify two
 * independently-generic functions both parameterized over Model<T> — a
 * still-abstract Model<T> passed as an argument into another such generic
 * function breaks inference even though each type-checks fine standalone
 * (see workspaceUtils.validateResourceAccess, which this mirrors).
 */

/**
 * Archive-flag entities (account, category, budget, savingsGoal,
 * recurringRule) have no `deletedAt` field at all — a sync
 * `operation: 'delete'` op is translated into the entity's REST "archive"
 * behavior instead. Unlike the REST archive endpoint, landing against an
 * already-archived record resolves as a harmless no-op rather than an
 * "already archived" error: bootstrap/pull may already have delivered that
 * state to this client before its queued local delete op flushed, and a
 * sync replay must not surface that timing as a failure.
 */
export const archiveEntityForOp = async <T extends EntityDoc>(
    model: Model<T>,
    userId: string,
    payload: Record<string, unknown>,
    notFoundMessage: string,
    isArchived: (doc: T) => boolean,
    archive: (doc: T) => void
): Promise<DeleteOpOutcome> => {
    const id = payload._id
    if (typeof id !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

    const doc = await model.findById(id)
    if (!doc) {
        throw new CustomError(notFoundMessage, 404)
    }
    if (doc.workspaceId) {
        await assertWorkspaceMembership(doc.workspaceId.toString(), userId, 'editor')
    } else if (doc.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    if (isArchived(doc)) {
        return { status: 'noop', resultId: doc._id.toString() }
    }

    archive(doc)
    await doc.save()

    return { status: 'applied', resultId: doc._id.toString() }
}

/**
 * True soft-delete entities (tag, categorizationRule, transactionTemplate)
 * tombstone unconditionally on delete — delete-always-wins, mirroring
 * deleteTransactionForOp's semantics but without any of transaction's
 * transfer-pair/split-child cascade logic, which doesn't apply here.
 *
 * `findById` bypasses the soft-delete plugin's default `deletedAt: null`
 * filter (mirroring fetchCurrentForConflictCheck's rationale for
 * transaction) so a delete op racing a second device's delete of the same
 * record — a distinct opId, since a fresh one is minted per outbox enqueue,
 * so the top-level SyncOperation idempotency check doesn't catch this case —
 * resolves as an idempotent no-op instead of a spurious 404.
 */
export const softDeleteEntityForOp = async <T extends EntityDoc & { deletedAt?: Date | null }>(
    model: Model<T>,
    userId: string,
    payload: Record<string, unknown>,
    notFoundMessage: string
): Promise<DeleteOpOutcome> => {
    const id = payload._id
    if (typeof id !== 'string') {
        throw new CustomError('Missing required field: _id', 400)
    }

    const doc = await model.findById(id).setOptions({ [SOFT_DELETE_BYPASS]: true })
    if (!doc) {
        throw new CustomError(notFoundMessage, 404)
    }
    if (doc.workspaceId) {
        await assertWorkspaceMembership(doc.workspaceId.toString(), userId, 'editor')
    } else if (doc.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    if (doc.deletedAt) {
        return { status: 'noop', resultId: doc._id.toString() }
    }

    doc.deletedAt = new Date()
    await doc.save()

    return { status: 'applied', resultId: doc._id.toString() }
}

/**
 * Sync ops don't carry a `req.user` (there's no request-scoped user object
 * on the push path the way REST controllers have via `getUserTimezone(req)`)
 * — period/date resolution that's timezone-sensitive (budget periods,
 * savings goal target dates, recurring rule due dates) looks the caller's
 * timezone up directly so sync-created records resolve the same
 * boundaries the REST endpoints would for the same user.
 */
export const getUserTimezoneForOp = async (userId: string): Promise<string> => {
    const user = await User.findById(userId).select('timezone')
    return user?.timezone?.trim() || DEFAULT_TIMEZONE
}
