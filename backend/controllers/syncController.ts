import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import { AuthRequest } from '../middleware/authTypes'
import Transaction, { ITransaction } from '../models/Transaction'
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

/**
 * Per-document last-write-wins with delete-always-wins (ROADMAP.md
 * "Conflicts"): delete never precondition-checks against baseUpdatedAt —
 * it tombstones unconditionally — while update always enforces it when
 * provided. That combination is what makes a racing update+delete in the
 * same push resolve to "deleted", regardless of which op runs first.
 */
const applyOp = async (userId: string, op: SyncOpInput): Promise<ApplyOpOutcome> => {
    const payload = op.payload ?? {}

    if (op.entity !== 'transaction') {
        throw new CustomError(`Unsupported sync entity: ${op.entity}`, 400)
    }

    if (op.operation === 'create') {
        return applyCreateOp(userId, payload)
    }

    if (op.operation === 'update') {
        return applyUpdateOp(userId, payload, op.baseUpdatedAt)
    }

    const resultId = await deleteTransactionForOp(userId, payload)
    return { status: 'applied', resultId }
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
