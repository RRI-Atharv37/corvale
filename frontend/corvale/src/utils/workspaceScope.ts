export const ACTIVE_WORKSPACE_STORAGE_KEY = 'corvale_active_workspace_id'

export const getStoredActiveWorkspaceId = (): string | null => {
    return localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)
}

export const setStoredActiveWorkspaceId = (workspaceId: string | null): void => {
    if (workspaceId) {
        localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId)
    } else {
        localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY)
    }
}

export const buildWorkspaceQueryParams = (
    workspaceId: string | null | undefined
): Record<string, string> => {
    if (workspaceId) {
        return { workspaceId }
    }
    return {}
}

export const buildWorkspaceBodyFields = (
    workspaceId: string | null | undefined
): { workspaceId?: string } => {
    if (workspaceId) {
        return { workspaceId }
    }
    return {}
}
