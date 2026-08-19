import axiosInstance from './axiosInstance'
import { API_PATHS } from './apiPaths'
import type { ApiResponse } from '../types/api'
import { unwrapApiData } from './apiHelpers'
import { buildWorkspaceQueryParams } from './workspaceScope'
import type { SyncableRecord } from '../db/repositories/Repository'

export interface BootstrapSyncSnapshot {
    checkpoint: string
    accounts: SyncableRecord[]
    transactions: SyncableRecord[]
    categories: SyncableRecord[]
    budgets: SyncableRecord[]
    savingsGoals: SyncableRecord[]
    tags: SyncableRecord[]
    recurringRules: SyncableRecord[]
}

export const fetchBootstrapSnapshot = async (
    workspaceId: string | null | undefined
): Promise<BootstrapSyncSnapshot> => {
    const response = await axiosInstance.get<ApiResponse<BootstrapSyncSnapshot>>(API_PATHS.SYNC.BOOTSTRAP, {
        params: buildWorkspaceQueryParams(workspaceId),
    })
    return unwrapApiData(response)
}
