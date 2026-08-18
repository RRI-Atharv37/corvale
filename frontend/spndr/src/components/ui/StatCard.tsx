import React from 'react'
import { IoAdd } from 'react-icons/io5'

export type StatCardAccent = 'income' | 'expense' | 'accent' | 'neutral'

interface StatCardProps {
    label: string
    value: string
    subtitle?: string
    accent: StatCardAccent
    onAdd?: () => void
    addLabel?: string
}

const accentClass: Record<StatCardAccent, string> = {
    income: 'stat-card--income',
    expense: 'stat-card--expense',
    accent: 'stat-card--accent',
    neutral: 'stat-card--neutral',
}

const StatCard: React.FC<StatCardProps> = ({ label, value, subtitle, accent, onAdd, addLabel }) => (
    <div className={`stat-card ${accentClass[accent]}`}>
        {onAdd && (
            <button
                type="button"
                onClick={onAdd}
                aria-label={addLabel ?? `Add ${label}`}
                title={addLabel ?? `Add ${label}`}
                className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border border-border text-fg-muted hover:border-accent/40 hover:text-accent transition-colors"
            >
                <IoAdd size={14} />
            </button>
        )}
        <p className="stat-card__label">{label}</p>
        <p className="stat-card__value">{value}</p>
        {subtitle && <p className="stat-card__subtitle">{subtitle}</p>}
    </div>
)

export default StatCard
