import axiosInstance from './axiosInstance'
import { API_PATHS } from './apiPaths'
import type {
    ApiResponse,
    Workspace,
    WorkspaceInviteFormData,
    WorkspaceInviteRole,
} from '../types/api'
import { unwrapApiData } from './apiHelpers'

export const fetchWorkspaces = async (): Promise<Workspace[]> => {
    const response = await axiosInstance.get<ApiResponse<Workspace[]>>(API_PATHS.WORKSPACES.GET_ALL)
    return unwrapApiData(response)
}

export const fetchWorkspaceById = async (workspaceId: string): Promise<Workspace> => {
    const response = await axiosInstance.get<ApiResponse<Workspace>>(
        API_PATHS.WORKSPACES.GET_BY_ID(workspaceId)
    )
    return unwrapApiData(response)
}

export const createWorkspace = async (name: string): Promise<Workspace> => {
    const response = await axiosInstance.post<ApiResponse<Workspace>>(API_PATHS.WORKSPACES.CREATE, {
        name,
    })
    return unwrapApiData(response)
}

export const updateWorkspace = async (workspaceId: string, name: string): Promise<Workspace> => {
    const response = await axiosInstance.patch<ApiResponse<Workspace>>(
        API_PATHS.WORKSPACES.UPDATE(workspaceId),
        { name }
    )
    return unwrapApiData(response)
}

export const inviteWorkspaceMember = async (
    workspaceId: string,
    payload: WorkspaceInviteFormData
): Promise<Workspace> => {
    const response = await axiosInstance.post<ApiResponse<Workspace>>(
        API_PATHS.WORKSPACES.INVITE(workspaceId),
        payload
    )
    return unwrapApiData(response)
}

export const updateWorkspaceMemberRole = async (
    workspaceId: string,
    memberUserId: string,
    role: WorkspaceInviteRole
): Promise<Workspace> => {
    const response = await axiosInstance.patch<ApiResponse<Workspace>>(
        API_PATHS.WORKSPACES.UPDATE_MEMBER(workspaceId, memberUserId),
        { role }
    )
    return unwrapApiData(response)
}

export const removeWorkspaceMember = async (
    workspaceId: string,
    memberUserId: string
): Promise<Workspace> => {
    const response = await axiosInstance.delete<ApiResponse<Workspace>>(
        API_PATHS.WORKSPACES.REMOVE_MEMBER(workspaceId, memberUserId)
    )
    return unwrapApiData(response)
}
