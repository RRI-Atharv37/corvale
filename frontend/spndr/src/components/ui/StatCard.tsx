import React from 'react'

export type StatCardAccent = 'income' | 'expense' | 'accent' | 'neutral'

interface StatCardProps {
    label: string
    value: string
    subtitle?: string
    accent: StatCardAccent
}

const accentClass: Record<StatCardAccent, string> = {
    income: 'stat-card--income',
    expense: 'stat-card--expense',
    accent: 'stat-card--accent',
    neutral: 'stat-card--neutral',
}

const StatCard: React.FC<StatCardProps> = ({ label, value, subtitle, accent }) => (
    <div className={`stat-card ${accentClass[accent]}`}>
        <p className="stat-card__label">{label}</p>
        <p className="stat-card__value">{value}</p>
        {subtitle && <p className="stat-card__subtitle">{subtitle}</p>}
    </div>
)

export default StatCard
