import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '../middleware/authTypes'
import SyncOperation, { SyncOpStatus } from '../models/SyncOperation'
import { CustomError } from '../utils/customError'
import { getUserId, handleResponses, validateRequiredFields } from '../utils/sharedUtils'
import { createTransactionForUser, deleteTransactionForOp } from '../services/transactionService'
import { fromMinorUnits } from '../../shared/src/money'

interface SyncOpInput {
    opId: string
    entity: string
    operation: 'create' | 'update' | 'delete'
    payload?: Record<string, unknown>
}

interface SyncOpResult {
    opId: string
    status: SyncOpStatus
    resultId: string | null
}

/**
 * Dispatches a single op to the entity/operation-specific service function.
 * Sprint 13.2 wires only what SyncOperation idempotency needs to be
 * verifiable end-to-end (transaction create/delete). Sprint 13.3 expands
 * this into the full bootstrap/pull/push contract across every entity.
 */
const applyOp = async (
    userId: string,
    op: SyncOpInput
): Promise<{ resultId: string | null }> => {
    const payload = op.payload ?? {}

    if (op.entity === 'transaction' && op.operation === 'create') {
        // Sync payloads carry `amount` in minor units (mirroring the local
        // SQLite/Transaction schema), whereas createTransactionForUser
        // expects the REST endpoint's major-unit decimal convention — convert
        // once here rather than teaching the shared service two amount formats.
        const transactionPayload = {
            ...payload,
            amount:
                typeof payload.amount === 'number' ? fromMinorUnits(payload.amount) : payload.amount,
        }
        const created = await createTransactionForUser(userId, transactionPayload)
        return { resultId: created._id.toString() }
    }

    if (op.entity === 'transaction' && op.operation === 'delete') {
        const resultId = await deleteTransactionForOp(userId, payload)
        return { resultId }
    }

    throw new CustomError(`Unsupported sync operation: ${op.entity}.${op.operation}`, 400)
}

export const pushSyncOps = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const ops = req.body?.ops

    if (!Array.isArray(ops) || ops.length === 0) {
        throw new CustomError('ops must be a non-empty array', 400)
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

        const { resultId } = await applyOp(userId, rawOp)
        await SyncOperation.create({
            userId,
            opId: rawOp.opId,
            entity: rawOp.entity,
            operation: rawOp.operation,
            status: 'applied',
            resultId,
        })
        results.push({ opId: rawOp.opId, status: 'applied', resultId })
    }

    handleResponses(res, 200, { results })
})
