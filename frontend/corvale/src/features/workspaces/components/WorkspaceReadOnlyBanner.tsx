import React from 'react'
import { FiEye } from 'react-icons/fi'
import { useWorkspace } from '@/app/providers/useWorkspace'

const WorkspaceReadOnlyBanner: React.FC = () => {
    const { canEdit, isPersonal, activeWorkspace } = useWorkspace()

    if (isPersonal || canEdit) {
        return null
    }

    return (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-border-subtle bg-surface/60 px-4 py-3">
            <FiEye size={18} className="mt-0.5 shrink-0 text-fg-muted" />
            <div>
                <p className="text-sm font-medium text-fg">View-only access</p>
                <p className="mt-0.5 text-sm text-fg-muted">
                    You are a viewer in {activeWorkspace?.name ?? 'this workspace'}. Create, edit,
                    and delete actions are hidden.
                </p>
            </div>
        </div>
    )
}

export default WorkspaceReadOnlyBanner
