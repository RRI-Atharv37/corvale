import axiosInstance from './axiosInstance'
import { API_PATHS } from './apiPaths'
import type { ApiResponse } from '../types/api'
import { unwrapApiData } from './apiHelpers'
import { buildWorkspaceQueryParams } from './workspaceScope'
import type { SyncableRecord } from '../db/repositories/Repository'
import type { OutboxOp } from '../sync/outbox'
import { parseOutboxEntity } from '../sync/entityMap'

export interface BootstrapSyncSnapshot {
    checkpoint: string
    accounts: SyncableRecord[]
    transactions: SyncableRecord[]
    categories: SyncableRecord[]
    budgets: SyncableRecord[]
    savingsGoals: SyncableRecord[]
    tags: SyncableRecord[]
    recurringRules: SyncableRecord[]
    categorizationRules: SyncableRecord[]
    savingsGoalContributions: SyncableRecord[]
}

export const fetchBootstrapSnapshot = async (
    workspaceId: string | null | undefined
): Promise<BootstrapSyncSnapshot> => {
    const response = await axiosInstance.get<ApiResponse<BootstrapSyncSnapshot>>(API_PATHS.SYNC.BOOTSTRAP, {
        params: buildWorkspaceQueryParams(workspaceId),
    })
    return unwrapApiData(response)
}

export interface SyncChange {
    entity: string
    doc: SyncableRecord
}

export interface SyncTombstone {
    entity: string
    _id: string
    deletedAt: string
}

export interface PullPage {
    changes: SyncChange[]
    tombstones: SyncTombstone[]
    checkpoint: string
    hasMore: boolean
}

export const fetchPullPage = async (
    workspaceId: string | null | undefined,
    checkpoint: string | null
): Promise<PullPage> => {
    const response = await axiosInstance.get<ApiResponse<PullPage>>(API_PATHS.SYNC.PULL, {
        params: {
            ...buildWorkspaceQueryParams(workspaceId),
            ...(checkpoint ? { checkpoint } : {}),
        },
    })
    return unwrapApiData(response)
}

/** Mirrors `backend/controllers/syncController.ts` `SyncOpStatus` - a superset of the `Outbox` core's `PushOpStatus`. */
export type SyncOpStatus = 'applied' | 'noop' | 'conflict' | 'rejected'

export interface SyncOpResult {
    opId: string
    status: SyncOpStatus
    resultId: string | null
    conflict?: { serverDoc: Record<string, unknown> }
    message?: string
}

export interface PushOpsResponse {
    results: SyncOpResult[]
    checkpoint: string
}

export const pushOutboxOps = async (ops: OutboxOp[]): Promise<PushOpsResponse> => {
    const response = await axiosInstance.post<ApiResponse<PushOpsResponse>>(API_PATHS.SYNC.PUSH, {
        ops: ops.map((op) => ({
            opId: op.opId,
            entity: parseOutboxEntity(op.entity).entityType,
            operation: op.operation,
            baseUpdatedAt: op.baseUpdatedAt,
            payload: op.payload,
        })),
    })
    return unwrapApiData(response)
}
