import React from 'react'
import { formatCurrency } from '../../utils/format'

interface SavingsGoalProgressBarProps {
    currentAmount: number
    targetAmount: number
    remaining: number
    percentComplete: number
    isComplete: boolean
    currency: string
}

const SavingsGoalProgressBar: React.FC<SavingsGoalProgressBarProps> = ({
    currentAmount,
    targetAmount,
    remaining,
    percentComplete,
    isComplete,
    currency,
}) => {
    const fillPercent = Math.min(100, percentComplete)

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
                <span className={isComplete ? 'text-income font-medium' : 'text-fg-muted'}>
                    {formatCurrency(currentAmount, currency)} saved
                </span>
                <span className="text-fg-muted">
                    {isComplete ? (
                        <span className="text-income font-medium">Goal reached</span>
                    ) : (
                        <>{formatCurrency(remaining, currency)} to go</>
                    )}
                </span>
            </div>
            <div
                className="h-2.5 w-full rounded-full bg-surface-hover overflow-hidden"
                role="progressbar"
                aria-valuenow={percentComplete}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Savings goal ${percentComplete}% complete`}
            >
                <div
                    className={`h-full rounded-full transition-all duration-300 ${
                        isComplete
                            ? 'bg-positive'
                            : percentComplete >= 75
                              ? 'bg-accent'
                              : percentComplete >= 40
                                ? 'bg-accent-end'
                                : 'bg-accent-start'
                    }`}
                    style={{ width: `${fillPercent}%` }}
                />
            </div>
            <div className="flex items-center justify-between text-[11px] text-fg-muted">
                <span>{percentComplete.toFixed(0)}% complete</span>
                <span>Target {formatCurrency(targetAmount, currency)}</span>
            </div>
        </div>
    )
}

export default SavingsGoalProgressBar
