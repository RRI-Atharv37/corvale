import React, { ReactNode } from 'react'
import type { IconType } from 'react-icons'
import { IoInformationCircleOutline, IoWarningOutline } from 'react-icons/io5'

export type DisclaimerTone = 'info' | 'caution'

interface DisclaimerProps {
    children: ReactNode
    /** `info` (default) for "this is an estimate" context; `caution` for content that could be read
     * as financial advice (the debt payoff planner). */
    tone?: DisclaimerTone
    className?: string
}

const TONE_STYLES: Record<DisclaimerTone, { container: string; icon: string; Icon: IconType }> = {
    info: {
        container: 'border-border-subtle bg-surface/50 text-fg-muted',
        icon: 'text-fg-muted',
        Icon: IoInformationCircleOutline,
    },
    caution: {
        container: 'border-warning/25 bg-warning/5 text-fg-secondary',
        icon: 'text-warning',
        Icon: IoWarningOutline,
    },
}

/**
 * Standing, **non-dismissible** disclaimer shown near Corvale's predictive and advisory surfaces
 * (V2). Copy lives in `utils/disclaimers.ts`; this is usually rendered through `PageHeader`'s `note`
 * slot. There is deliberately no close button or dismissed state - the context is always relevant,
 * not a one-time hint.
 */
const Disclaimer: React.FC<DisclaimerProps> = ({ children, tone = 'info', className = '' }) => {
    const { container, icon, Icon } = TONE_STYLES[tone]

    return (
        <div
            role="note"
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${container} ${className}`.trim()}
        >
            <Icon size={14} aria-hidden="true" className={`mt-0.5 shrink-0 ${icon}`} />
            <p>{children}</p>
        </div>
    )
}

export default Disclaimer
