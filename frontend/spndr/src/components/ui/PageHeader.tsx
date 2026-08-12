import React, { ReactNode } from 'react'

interface PageHeaderProps {
    title: string
    description?: string
    actions?: ReactNode
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions }) => {
    return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
                <h1 className="text-2xl font-semibold text-slate-100 tracking-tight">{title}</h1>
                {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
            </div>
            {actions && <div className="flex items-center gap-3">{actions}</div>}
        </div>
    )
}

export default PageHeader
