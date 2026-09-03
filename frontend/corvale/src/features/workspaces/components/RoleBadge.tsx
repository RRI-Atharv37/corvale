import React from 'react'
import type { WorkspaceRole } from '@features/workspaces/types'

interface RoleBadgeProps {
    role: WorkspaceRole
    className?: string
}

const ROLE_STYLES: Record<WorkspaceRole, string> = {
    owner: 'bg-warning/15 border-warning/30 text-warning',
    editor: 'bg-accent-subtle border-accent/30 text-accent',
    viewer: 'bg-surface-hover border-border-subtle text-fg-muted',
}

const ROLE_LABELS: Record<WorkspaceRole, string> = {
    owner: 'Owner',
    editor: 'Editor',
    viewer: 'Viewer',
}

const RoleBadge: React.FC<RoleBadgeProps> = ({ role, className = '' }) => (
    <span
        className={[
            'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize',
            ROLE_STYLES[role],
            className,
        ].join(' ')}
    >
        {ROLE_LABELS[role]}
    </span>
)

export default RoleBadge
