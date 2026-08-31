import { useCallback } from 'react'
import { isLocalFirstEnabled } from '../../../utils/localFirstFlag'
import { getLocalDb } from '../../../db/localDbInstance'
import { tableInvalidationBus } from '../../../db/invalidation/tableInvalidationBus'
import { useUser } from '../../../hooks/useUser'
import {
    parseImportFile as parseImportFileServer,
    previewImport as previewImportServer,
    commitImport as commitImportServer,
    type ImportPreviewPayload,
} from '../../../utils/importApi'
import {
    parseLocalImportFile,
    previewLocalImport,
    commitLocalImport,
} from '../../../domain/importTransactions'
import type {
    ImportCommitResponse,
    ImportDelimiter,
    ImportParseResponse,
    ImportPreviewResponse,
} from '../../../types/api'

export interface UseImportTransactionsDataResult {
    parseImportFile: (file: File, delimiter?: ImportDelimiter) => Promise<ImportParseResponse>
    previewImport: (payload: ImportPreviewPayload) => Promise<ImportPreviewResponse>
    commitImport: (payload: ImportPreviewPayload) => Promise<ImportCommitResponse>
}

/**
 * Data layer for the CSV/OFX import wizard (Sprint 13.10). Branches on `isLocalFirstEnabled()`
 * exactly like `useTransactionsData.ts`: the server branch is the page's pre-existing
 * `utils/importApi.ts` REST calls; the local branch parses the file with the File API (no
 * network), previews duplicate detection against local transactions, and commits accepted rows
 * through `domain/importTransactions.ts`, which writes via `Repository.create`/`update` so every
 * accepted row queues to the outbox automatically - including the existing "workspace-scoped
 * writes require connectivity" rejection from `sync/outbox.ts` when offline.
 */
export const useImportTransactionsData = (): UseImportTransactionsDataResult => {
    const { user } = useUser()
    const localFirst = isLocalFirstEnabled()

    const parseImportFile = useCallback(
        async (file: File, delimiter?: ImportDelimiter): Promise<ImportParseResponse> => {
            if (!localFirst) {
                return parseImportFileServer(file, delimiter)
            }
            return parseLocalImportFile(file, delimiter)
        },
        [localFirst]
    )

    const previewImport = useCallback(
        async (payload: ImportPreviewPayload): Promise<ImportPreviewResponse> => {
            if (!localFirst) {
                return previewImportServer(payload)
            }
            const db = await getLocalDb()
            return previewLocalImport(db, payload)
        },
        [localFirst]
    )

    const commitImport = useCallback(
        async (payload: ImportPreviewPayload): Promise<ImportCommitResponse> => {
            if (!localFirst) {
                return commitImportServer(payload)
            }
            if (!user) {
                throw new Error('Not authenticated')
            }
            const db = await getLocalDb()
            const result = await commitLocalImport(db, {
                ...payload,
                userId: user._id,
                workspaceId: payload.workspaceId ?? null,
            })
            tableInvalidationBus.publish('transactions')
            tableInvalidationBus.publish('accounts')
            return result
        },
        [localFirst, user]
    )

    return { parseImportFile, previewImport, commitImport }
}
