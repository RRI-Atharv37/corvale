import React from 'react'

import type { BillingInterval } from '../types'

interface IntervalToggleProps {
    value: BillingInterval
    onChange: (interval: BillingInterval) => void
}

const OPTIONS: { value: BillingInterval; label: string }[] = [
    { value: 'monthly', label: 'Monthly' },
    { value: 'annual', label: 'Annual' },
]

const IntervalToggle: React.FC<IntervalToggleProps> = ({ value, onChange }) => (
    <div
        role="radiogroup"
        aria-label="Billing interval"
        className="inline-flex rounded-full border border-border-subtle bg-bg-secondary p-1"
    >
        {OPTIONS.map((option) => {
            const selected = option.value === value
            return (
                <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange(option.value)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                        selected ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
                    }`}
                >
                    {option.label}
                </button>
            )
        })}
    </div>
)

export default IntervalToggle
