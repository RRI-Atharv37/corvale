import React, { ReactNode } from 'react'
import { FiInbox } from 'react-icons/fi'

interface EmptyStateProps {
    title: string
    description?: string
    action?: ReactNode
}

const EmptyState: React.FC<EmptyStateProps> = ({ title, description, action }) => {
    return (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center max-w-md mx-auto">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 border border-slate-700/80">
                <FiInbox className="text-slate-400" size={22} />
            </div>
            <div>
                <h3 className="text-base font-medium text-slate-200">{title}</h3>
                {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
            </div>
            {action}
        </div>
    )
}

export default EmptyState
