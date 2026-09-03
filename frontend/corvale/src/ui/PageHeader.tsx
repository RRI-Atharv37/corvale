import React, { ReactNode } from 'react'

interface PageHeaderProps {
    title: string
    description?: string
    actions?: ReactNode
    /** Optional full-width slot rendered under the title/description row - used to hang a standing
     * `<Disclaimer>` on predictive/advisory pages (V2). Additive: omit it and the header is unchanged. */
    note?: ReactNode
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions, note }) => {
    return (
        <div className="mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="font-display text-2xl font-bold text-text-primary tracking-tight">{title}</h1>
                    {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
                </div>
                {actions && <div className="flex items-center gap-3">{actions}</div>}
            </div>
            {note && <div className="mt-4">{note}</div>}
        </div>
    )
}

export default PageHeader
