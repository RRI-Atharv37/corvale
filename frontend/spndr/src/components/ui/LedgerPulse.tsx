import React from 'react'

interface LedgerPulseProps {
    className?: string
    /** Wider variant for hero sections */
    variant?: 'default' | 'wide'
}

/**
 * Signature element: a ledger line with a traveling accent pulse.
 */
const LedgerPulse: React.FC<LedgerPulseProps> = ({ className = '', variant = 'default' }) => {
    return (
        <div
            className={[
                'ledger-pulse relative w-full overflow-hidden',
                variant === 'wide' ? 'h-px my-10' : 'h-px my-6',
                className,
            ].join(' ')}
            aria-hidden="true"
        >
            <div className="absolute inset-0 bg-border/60" />
            <div className="ledger-pulse-glow absolute top-0 h-full w-24" />
        </div>
    )
}

export default LedgerPulse
