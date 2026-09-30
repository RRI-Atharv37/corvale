import type { LocalDb } from '../db/LocalDb'
import { TABLE_TO_ENTITY } from './entityMap'
import { checkpointKey } from './checkpointStore'

const WORKSPACE_TABLES = ['accounts', 'transactions', 'budgets', 'savingsGoals', 'recurringRules'] as const

const CHUNK_SIZE = 500

const WORKSPACE_CHECKPOINT_PATTERN = 'checkpoint:ws:%'

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ')

const inChunks = async (values: string[], run: (chunk: string[]) => Promise<void>): Promise<void> => {
    for (let start = 0; start < values.length; start += CHUNK_SIZE) {
        await run(values.slice(start, start + CHUNK_SIZE))
    }
}

/**
 * SEC-82: removes every locally held row that belongs to a workspace the user is not a member of
 * any more, together with what hangs off those rows (queued ops, conflicts, cached receipts and
 * queued receipt uploads, the workspace's pull checkpoint). Personal rows and workspaces in
 * `memberWorkspaceIds` are untouched. Returns the syncable tables that lost rows.
 *
 * Only call this with an authoritative membership list (a successful online fetch): an empty list
 * from a failed or offline fetch would otherwise wipe workspaces the user still belongs to.
 */
export const purgeWorkspacesNotIn = async (db: LocalDb, memberWorkspaceIds: string[]): Promise<string[]> => {
    const touched: string[] = []

    await db.transaction(async (tx) => {
        const memberFilter = memberWorkspaceIds.length
            ? ` AND workspaceId NOT IN (${placeholders(memberWorkspaceIds.length)})`
            : ''
        const purgedIdsByTable = new Map<string, string[]>()

        for (const table of WORKSPACE_TABLES) {
            const rows = await tx.select<{ _id: string }>(
                `SELECT _id FROM ${table} WHERE workspaceId IS NOT NULL${memberFilter}`,
                memberWorkspaceIds
            )
            if (rows.length > 0) purgedIdsByTable.set(table, rows.map((row) => row._id))
        }

        const goalIds = purgedIdsByTable.get('savingsGoals') ?? []
        if (goalIds.length > 0) {
            const contributionIds: string[] = []
            await inChunks(goalIds, async (chunk) => {
                const rows = await tx.select<{ _id: string }>(
                    `SELECT _id FROM savingsGoalContributions WHERE goalId IN (${placeholders(chunk.length)})`,
                    chunk
                )
                contributionIds.push(...rows.map((row) => row._id))
            })
            if (contributionIds.length > 0) purgedIdsByTable.set('savingsGoalContributions', contributionIds)
        }

        for (const [table, ids] of purgedIdsByTable) {
            const entity = TABLE_TO_ENTITY[table as keyof typeof TABLE_TO_ENTITY]
            await inChunks(ids, async (chunk) => {
                const marks = placeholders(chunk.length)
                await tx.exec(`DELETE FROM ${table} WHERE _id IN (${marks})`, chunk)
                await tx.exec(
                    `DELETE FROM _outbox WHERE entity IN (${marks})`,
                    chunk.map((id) => `${entity}:${id}`)
                )
                await tx.exec(`DELETE FROM _conflicts WHERE entity = ? AND recordId IN (${marks})`, [entity, ...chunk])
                if (table === 'transactions') {
                    await tx.exec(`DELETE FROM _receipt_uploads WHERE transactionId IN (${marks})`, chunk)
                    await tx.exec(`DELETE FROM _blobs WHERE entity = 'receipt' AND recordId IN (${marks})`, chunk)
                }
            })
            touched.push(table)
        }

        const keptCheckpoints = memberWorkspaceIds.map((id) => checkpointKey(id))
        await tx.exec(
            `DELETE FROM _sync_meta WHERE key LIKE ?${
                keptCheckpoints.length ? ` AND key NOT IN (${placeholders(keptCheckpoints.length)})` : ''
            }`,
            [WORKSPACE_CHECKPOINT_PATTERN, ...keptCheckpoints]
        )
    })

    return touched
}
