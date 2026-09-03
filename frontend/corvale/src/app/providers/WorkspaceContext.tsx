import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import type { Workspace, WorkspaceRole } from '@lib/types/api'
import { fetchWorkspaces } from '@features/workspaces/workspaceApi'
import { getApiErrorMessage } from '@lib/apiError'
import {
    getStoredActiveWorkspaceId,
    setStoredActiveWorkspaceId,
} from '@lib/workspaceScope'
import { useUser } from './useUser'

interface WorkspaceContextType {
    activeWorkspaceId: string | null
    activeWorkspace: Workspace | null
    workspaces: Workspace[]
    loading: boolean
    error: string | null
    role: WorkspaceRole | null
    canEdit: boolean
    isOwner: boolean
    isPersonal: boolean
    setActiveWorkspace: (workspaceId: string | null) => void
    refetchWorkspaces: () => Promise<void>
}

export const WorkspaceContext = createContext<WorkspaceContextType | null>(null)

const resolveMemberRole = (
    workspace: Workspace | null,
    userId: string | undefined
): WorkspaceRole | null => {
    if (!workspace || !userId) return null
    return workspace.members.find((member) => member.userId === userId)?.role ?? null
}

const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, isAuthenticated } = useUser()
    const [workspaces, setWorkspaces] = useState<Workspace[]>([])
    const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(() =>
        getStoredActiveWorkspaceId()
    )
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const refetchWorkspaces = useCallback(async () => {
        if (!isAuthenticated) {
            setWorkspaces([])
            setLoading(false)
            return
        }

        setLoading(true)
        setError(null)
        try {
            const list = await fetchWorkspaces()
            setWorkspaces(list)

            // Only a successful fetch made while actually online is authoritative enough to
            // evict the stored active workspace. A fetch that failed, or one that "succeeded"
            // with an empty list while offline (e.g. a stale local-first cache), must never be
            // read as "the user is no longer a member" - that's a network/offline symptom, not
            // a membership fact (Sprint 13.7 fix).
            const isAuthoritative = typeof navigator === 'undefined' || navigator.onLine
            if (isAuthoritative) {
                setActiveWorkspaceIdState((current) => {
                    if (!current || list.some((workspace) => workspace._id === current)) {
                        return current
                    }
                    setStoredActiveWorkspaceId(null)
                    return null
                })
            }
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to load workspaces'))
        } finally {
            setLoading(false)
        }
    }, [isAuthenticated])

    useEffect(() => {
        void refetchWorkspaces()
    }, [refetchWorkspaces])

    const setActiveWorkspace = useCallback((workspaceId: string | null) => {
        setActiveWorkspaceIdState(workspaceId)
        setStoredActiveWorkspaceId(workspaceId)
    }, [])

    const activeWorkspace = useMemo(
        () => workspaces.find((workspace) => workspace._id === activeWorkspaceId) ?? null,
        [workspaces, activeWorkspaceId]
    )

    const role = useMemo(
        () => (activeWorkspaceId ? resolveMemberRole(activeWorkspace, user?._id) : null),
        [activeWorkspace, activeWorkspaceId, user?._id]
    )

    const isPersonal = activeWorkspaceId === null
    const canEdit = isPersonal || role === 'owner' || role === 'editor'
    const isOwner = role === 'owner'

    const value = useMemo(
        () => ({
            activeWorkspaceId,
            activeWorkspace,
            workspaces,
            loading,
            error,
            role,
            canEdit,
            isOwner,
            isPersonal,
            setActiveWorkspace,
            refetchWorkspaces,
        }),
        [
            activeWorkspaceId,
            activeWorkspace,
            workspaces,
            loading,
            error,
            role,
            canEdit,
            isOwner,
            isPersonal,
            setActiveWorkspace,
            refetchWorkspaces,
        ]
    )

    return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export default WorkspaceProvider
