import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '@http/middleware/authTypes'
import {
    assertWorkspaceReadable,
    buildBootstrapSnapshot,
    buildPullPage,
} from './sync.service'
import { applyPushBatch } from './syncPush.service'
import { parseOptionalWorkspaceId } from '@core/access/workspace'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'

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
    const result = await applyPushBatch(getUserId(req), req.body?.ops, req.body?.workspaceId)
    handleResponses(res, 200, result)
})
