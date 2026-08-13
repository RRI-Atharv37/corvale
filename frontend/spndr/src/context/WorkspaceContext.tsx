import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import type { Workspace, WorkspaceRole } from '../types/api'
import { fetchWorkspaces } from '../utils/workspaceApi'
import { getApiErrorMessage } from '../utils/apiError'
import {
    getStoredActiveWorkspaceId,
    setStoredActiveWorkspaceId,
} from '../utils/workspaceScope'
import { useUser } from '../hooks/useUser'

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
        } catch (err) {
            setError(getApiErrorMessage(err, 'Failed to load workspaces'))
            setWorkspaces([])
        } finally {
            setLoading(false)
        }
    }, [isAuthenticated])

    useEffect(() => {
        void refetchWorkspaces()
    }, [refetchWorkspaces])

    useEffect(() => {
        if (!activeWorkspaceId) return
        const stillMember = workspaces.some((workspace) => workspace._id === activeWorkspaceId)
        if (!stillMember) {
            setActiveWorkspaceIdState(null)
            setStoredActiveWorkspaceId(null)
        }
    }, [activeWorkspaceId, workspaces])

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
