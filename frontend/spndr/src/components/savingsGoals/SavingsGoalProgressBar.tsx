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
                <span className={isComplete ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
                    {formatCurrency(currentAmount, currency)} saved
                </span>
                <span className="text-slate-500">
                    {isComplete ? (
                        <span className="text-emerald-400 font-medium">Goal reached</span>
                    ) : (
                        <>{formatCurrency(remaining, currency)} to go</>
                    )}
                </span>
            </div>
            <div
                className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden"
                role="progressbar"
                aria-valuenow={percentComplete}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Savings goal ${percentComplete}% complete`}
            >
                <div
                    className={`h-full rounded-full transition-all duration-300 ${
                        isComplete
                            ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                            : percentComplete >= 75
                              ? 'bg-gradient-to-r from-cyan-500 to-cyan-400'
                              : percentComplete >= 40
                                ? 'bg-gradient-to-r from-violet-500 to-violet-400'
                                : 'bg-gradient-to-r from-indigo-500 to-indigo-400'
                    }`}
                    style={{ width: `${fillPercent}%` }}
                />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>{percentComplete.toFixed(0)}% complete</span>
                <span>Target {formatCurrency(targetAmount, currency)}</span>
            </div>
        </div>
    )
}

export default SavingsGoalProgressBar
