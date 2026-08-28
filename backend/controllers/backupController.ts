import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import {
    createBackupZipStream,
    exportUserBackup,
    extractBackupFromUpload,
    parseBackupPayload,
    previewBackupRestore,
    restoreUserBackup,
} from '../utils/backupUtils'
import { getUserId, handleResponses } from '../utils/sharedUtils'
import {
    assertWorkspaceMembership,
    parseOptionalWorkspaceId,
} from '../utils/workspaceUtils'

const resolveExportScope = async (
    userId: string,
    workspaceId: string | null | undefined
): Promise<string | null> => {
    const resolved = parseOptionalWorkspaceId(workspaceId) ?? null
    if (resolved) {
        await assertWorkspaceMembership(resolved, userId, 'editor')
    }
    return resolved
}

export const exportBackup = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const workspaceId = await resolveExportScope(
        userId,
        typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined
    )
    const format = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : 'json'

    const payload = await exportUserBackup(userId, workspaceId)

    if (format === 'zip') {
        const { stream, filename } = await createBackupZipStream(userId, payload)
        res.setHeader('Content-Type', 'application/zip')
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.zip"`)
        stream.pipe(res)
        return
    }

    const scopeLabel = workspaceId ? 'workspace' : 'personal'
    const filename = `corvale-backup-${scopeLabel}-${payload.exportedAt.slice(0, 10)}.json`

    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.status(200).send(JSON.stringify(payload, null, 2))
})

export const previewRestore = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const targetWorkspaceId = await resolveExportScope(userId, req.body.workspaceId)

    let payload = req.body.backup
    if (!payload && req.file) {
        const extracted = extractBackupFromUpload(req.file.buffer, req.file.originalname)
        payload = extracted.payload
    }

    if (!payload) {
        throw new CustomError(ERROR_MESSAGES.BACKUP.FILE_REQUIRED, 400)
    }

    const backup = parseBackupPayload(payload)
    const preview = previewBackupRestore(backup, targetWorkspaceId)
    handleResponses(res, 200, preview)
})

export const commitRestore = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const targetWorkspaceId = await resolveExportScope(userId, req.body.workspaceId)

    let payload = req.body.backup
    let receiptFiles: Map<string, Buffer> | undefined

    if (!payload && req.file) {
        const extracted = extractBackupFromUpload(req.file.buffer, req.file.originalname)
        payload = extracted.payload
        receiptFiles = extracted.receiptFiles
    }

    if (!payload) {
        throw new CustomError(ERROR_MESSAGES.BACKUP.FILE_REQUIRED, 400)
    }

    const backup = parseBackupPayload(payload)
    const result = await restoreUserBackup(userId, backup, targetWorkspaceId, receiptFiles)
    handleResponses(res, 201, result)
})
