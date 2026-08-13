import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { IoAdd, IoPeople, IoTrash } from 'react-icons/io5'
import { FiLogOut } from 'react-icons/fi'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import EmptyState from '../../components/ui/EmptyState'
import Modal from '../../components/ui/Modal'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import FormField from '../../components/forms/FormField'
import RoleBadge from '../../components/workspaces/RoleBadge'
import { useWorkspace } from '../../hooks/useWorkspace'
import { useUser } from '../../hooks/useUser'
import type { Workspace, WorkspaceInviteFormData, WorkspaceInviteRole } from '../../types/api'
import {
    createWorkspace,
    inviteWorkspaceMember,
    removeWorkspaceMember,
    updateWorkspaceMemberRole,
} from '../../utils/workspaceApi'
import { getApiErrorMessage } from '../../utils/apiError'

const emptyCreateForm = (): { name: string } => ({ name: '' })

const emptyInviteForm = (): WorkspaceInviteFormData => ({
    email: '',
    role: 'editor',
})

const INVITE_ROLE_OPTIONS: { value: WorkspaceInviteRole; label: string }[] = [
    { value: 'editor', label: 'Editor — can add and edit data' },
    { value: 'viewer', label: 'Viewer — read-only access' },
]

interface SelectFieldProps {
    label: string
    value: string
    onChange: (value: string) => void
    options: { value: string; label: string }[]
    required?: boolean
    disabled?: boolean
}

const SelectField: React.FC<SelectFieldProps> = ({
    label,
    value,
    onChange,
    options,
    required,
    disabled,
}) => (
    <div>
        <label className="text-[13px] text-fg-secondary">
            {label}
            {required && <span className="text-expense ml-0.5">*</span>}
        </label>
        <div className="input-box mb-0 mt-1">
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                required={required}
                disabled={disabled}
                className="w-full bg-transparent outline-none text-fg"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value} className="bg-surface">
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    </div>
)

const getMemberRole = (workspace: Workspace, userId: string) =>
    workspace.members.find((member) => member.userId === userId)?.role ?? null

const Workspaces = () => {
    const { user } = useUser()
    const { workspaces, loading, error, refetchWorkspaces, setActiveWorkspace, activeWorkspaceId } =
        useWorkspace()

    const [createOpen, setCreateOpen] = useState(false)
    const [createForm, setCreateForm] = useState(emptyCreateForm)
    const [submitting, setSubmitting] = useState(false)

    const [membersOpen, setMembersOpen] = useState(false)
    const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null)
    const [inviteForm, setInviteForm] = useState(emptyInviteForm)
    const [inviting, setInviting] = useState(false)
    const [memberActionId, setMemberActionId] = useState<string | null>(null)
    const [leaveTarget, setLeaveTarget] = useState<Workspace | null>(null)
    const [leaving, setLeaving] = useState(false)
    const [removeTarget, setRemoveTarget] = useState<{ workspace: Workspace; memberUserId: string; name: string } | null>(null)
    const [removing, setRemoving] = useState(false)

    const refreshList = useCallback(async () => {
        await refetchWorkspaces()
    }, [refetchWorkspaces])

    useEffect(() => {
        if (!selectedWorkspace) return
        const latest = workspaces.find((workspace) => workspace._id === selectedWorkspace._id)
        if (latest) {
            setSelectedWorkspace(latest)
        }
    }, [workspaces, selectedWorkspace?._id])

    const openMembers = (workspace: Workspace) => {
        setSelectedWorkspace(workspace)
        setInviteForm(emptyInviteForm())
        setMembersOpen(true)
    }

    const closeMembers = () => {
        setMembersOpen(false)
        setSelectedWorkspace(null)
        setInviteForm(emptyInviteForm())
    }

    const syncSelectedWorkspace = useCallback(
        (updated: Workspace) => {
            setSelectedWorkspace(updated)
        },
        []
    )

    const selectedRole = useMemo(() => {
        if (!selectedWorkspace || !user) return null
        return getMemberRole(selectedWorkspace, user._id)
    }, [selectedWorkspace, user])

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!createForm.name.trim()) {
            toast.error('Workspace name is required')
            return
        }

        setSubmitting(true)
        try {
            const created = await createWorkspace(createForm.name.trim())
            toast.success('Workspace created')
            setCreateOpen(false)
            setCreateForm(emptyCreateForm())
            await refreshList()
            setActiveWorkspace(created._id)
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to create workspace'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!selectedWorkspace) return

        if (!inviteForm.email.trim()) {
            toast.error('Email is required')
            return
        }

        setInviting(true)
        try {
            const updated = await inviteWorkspaceMember(selectedWorkspace._id, {
                email: inviteForm.email.trim(),
                role: inviteForm.role,
            })
            syncSelectedWorkspace(updated)
            setInviteForm(emptyInviteForm())
            toast.success('Member invited')
            await refreshList()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to invite member'))
        } finally {
            setInviting(false)
        }
    }

    const handleRoleChange = async (memberUserId: string, role: WorkspaceInviteRole) => {
        if (!selectedWorkspace) return

        setMemberActionId(memberUserId)
        try {
            const updated = await updateWorkspaceMemberRole(
                selectedWorkspace._id,
                memberUserId,
                role
            )
            syncSelectedWorkspace(updated)
            toast.success('Member role updated')
            await refreshList()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to update member role'))
        } finally {
            setMemberActionId(null)
        }
    }

    const handleRemoveMember = async () => {
        if (!removeTarget) return

        setRemoving(true)
        try {
            const updated = await removeWorkspaceMember(
                removeTarget.workspace._id,
                removeTarget.memberUserId
            )
            if (selectedWorkspace?._id === removeTarget.workspace._id) {
                syncSelectedWorkspace(updated)
            }
            toast.success('Member removed')
            setRemoveTarget(null)
            await refreshList()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to remove member'))
        } finally {
            setRemoving(false)
        }
    }

    const handleLeave = async () => {
        if (!leaveTarget || !user) return

        setLeaving(true)
        try {
            await removeWorkspaceMember(leaveTarget._id, user._id)
            if (activeWorkspaceId === leaveTarget._id) {
                setActiveWorkspace(null)
            }
            if (selectedWorkspace?._id === leaveTarget._id) {
                closeMembers()
            }
            toast.success('Left workspace')
            setLeaveTarget(null)
            await refreshList()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to leave workspace'))
        } finally {
            setLeaving(false)
        }
    }

    const openCreateModal = () => {
        setCreateForm(emptyCreateForm())
        setCreateOpen(true)
    }

    return (
        <div>
            <PageHeader
                title="Workspaces"
                description="Create shared spaces and invite others to manage finances together"
                actions={
                    <button
                        type="button"
                        onClick={openCreateModal}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg btn-accent transition-colors"
                    >
                        <IoAdd size={18} />
                        New workspace
                    </button>
                }
            />

            <AsyncContent
                loading={loading}
                error={error}
                data={workspaces}
                isEmpty={(items) => items.length === 0}
                loadingMessage="Loading workspaces..."
                emptyTitle="No workspaces yet"
                emptyDescription="Create a workspace to share accounts, transactions, and budgets with others."
                onRetry={refreshList}
            >
                {(items) => (
                    <div className="space-y-3">
                        {items.map((workspace) => {
                            const myRole = user ? getMemberRole(workspace, user._id) : null
                            const isActive = activeWorkspaceId === workspace._id

                            return (
                                <div
                                    key={workspace._id}
                                    className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-sm font-medium text-fg truncate">
                                                {workspace.name}
                                            </p>
                                            {myRole && <RoleBadge role={myRole} />}
                                            {isActive && (
                                                <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent-subtle px-2 py-0.5 text-[11px] font-medium text-accent">
                                                    Active
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-fg-muted mt-0.5">
                                            {workspace.members.length} member
                                            {workspace.members.length === 1 ? '' : 's'}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        {!isActive && (
                                            <button
                                                type="button"
                                                onClick={() => setActiveWorkspace(workspace._id)}
                                                className="px-3 py-1.5 text-sm rounded-lg border border-border text-fg-secondary hover:border-accent/40 transition-colors"
                                            >
                                                Switch to
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => openMembers(workspace)}
                                            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-accent/30 text-accent hover:bg-accent-subtle transition-colors"
                                        >
                                            <IoPeople size={16} />
                                            Members
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </AsyncContent>

            <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create workspace">
                <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
                    <FormField
                        label="Workspace name"
                        value={createForm.name}
                        onChange={(value) => setCreateForm({ name: value })}
                        placeholder="Roommates, Family budget, etc."
                        required
                        disabled={submitting}
                    />
                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={() => setCreateOpen(false)}
                            disabled={submitting}
                            className="px-4 py-2 text-sm rounded-lg border border-border text-fg-secondary hover:border-accent/40 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="px-4 py-2 text-sm font-medium rounded-lg btn-accent disabled:opacity-50"
                        >
                            {submitting ? 'Creating...' : 'Create workspace'}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal
                open={membersOpen}
                onClose={closeMembers}
                title={selectedWorkspace ? `${selectedWorkspace.name} — Members` : 'Members'}
                size="md"
            >
                {selectedWorkspace && (
                    <div className="space-y-6">
                        {selectedRole === 'owner' && (
                            <form onSubmit={(e) => void handleInvite(e)} className="space-y-3">
                                <p className="section-label">Invite member</p>
                                <FormField
                                    label="Email"
                                    type="email"
                                    value={inviteForm.email}
                                    onChange={(value) =>
                                        setInviteForm((current) => ({ ...current, email: value }))
                                    }
                                    placeholder="colleague@example.com"
                                    required
                                    disabled={inviting}
                                />
                                <SelectField
                                    label="Role"
                                    value={inviteForm.role}
                                    onChange={(value) =>
                                        setInviteForm((current) => ({
                                            ...current,
                                            role: value as WorkspaceInviteRole,
                                        }))
                                    }
                                    options={INVITE_ROLE_OPTIONS}
                                    required
                                    disabled={inviting}
                                />
                                <button
                                    type="submit"
                                    disabled={inviting}
                                    className="w-full px-4 py-2 text-sm font-medium rounded-lg btn-accent disabled:opacity-50"
                                >
                                    {inviting ? 'Inviting...' : 'Send invite'}
                                </button>
                            </form>
                        )}

                        <div>
                            <p className="section-label mb-3">Members</p>
                            {selectedWorkspace.members.length === 0 ? (
                                <EmptyState
                                    title="No members"
                                    description="This workspace has no members yet."
                                />
                            ) : (
                                <div className="space-y-2">
                                    {selectedWorkspace.members.map((member) => {
                                        const isSelf = member.userId === user?._id
                                        const displayName =
                                            member.fullName?.trim() ||
                                            member.email ||
                                            'Unknown user'
                                        const canManage =
                                            selectedRole === 'owner' &&
                                            member.role !== 'owner' &&
                                            !isSelf

                                        return (
                                            <div
                                                key={member.userId}
                                                className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface/40 px-3 py-2.5"
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-fg truncate">
                                                        {displayName}
                                                        {isSelf ? ' (you)' : ''}
                                                    </p>
                                                    {member.email && member.fullName && (
                                                        <p className="text-xs text-fg-muted truncate">
                                                            {member.email}
                                                        </p>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-2 shrink-0">
                                                    {canManage ? (
                                                        <select
                                                            value={member.role}
                                                            disabled={memberActionId === member.userId}
                                                            onChange={(e) =>
                                                                void handleRoleChange(
                                                                    member.userId,
                                                                    e.target.value as WorkspaceInviteRole
                                                                )
                                                            }
                                                            className="rounded-lg border border-border-subtle bg-bg-secondary px-2 py-1 text-xs text-fg outline-none focus:border-accent/40"
                                                        >
                                                            <option value="editor">Editor</option>
                                                            <option value="viewer">Viewer</option>
                                                        </select>
                                                    ) : (
                                                        <RoleBadge role={member.role} />
                                                    )}

                                                    {canManage && (
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                setRemoveTarget({
                                                                    workspace: selectedWorkspace,
                                                                    memberUserId: member.userId,
                                                                    name: displayName,
                                                                })
                                                            }
                                                            className="p-1.5 text-fg-muted hover:text-destructive transition-colors"
                                                            aria-label={`Remove ${displayName}`}
                                                            title="Remove member"
                                                        >
                                                            <IoTrash size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        {selectedRole && selectedRole !== 'owner' && user && (
                            <button
                                type="button"
                                onClick={() => setLeaveTarget(selectedWorkspace)}
                                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border-subtle px-3 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
                            >
                                <FiLogOut size={16} />
                                Leave workspace
                            </button>
                        )}
                    </div>
                )}
            </Modal>

            <ConfirmDialog
                open={Boolean(removeTarget)}
                onClose={() => setRemoveTarget(null)}
                onConfirm={() => void handleRemoveMember()}
                title="Remove member"
                message={
                    removeTarget
                        ? `Remove ${removeTarget.name} from this workspace? They will lose access immediately.`
                        : ''
                }
                confirmLabel="Remove"
                loading={removing}
            />

            <ConfirmDialog
                open={Boolean(leaveTarget)}
                onClose={() => setLeaveTarget(null)}
                onConfirm={() => void handleLeave()}
                title="Leave workspace"
                message={
                    leaveTarget
                        ? `Leave "${leaveTarget.name}"? You will lose access to its shared data.`
                        : ''
                }
                confirmLabel="Leave"
                loading={leaving}
            />
        </div>
    )
}

export default Workspaces
