import React from 'react'
import { formatCurrency } from '../../utils/format'

interface BudgetProgressBarProps {
    spent: number
    remaining: number
    budgetAmount: number
    percentUsed: number
    isOverBudget: boolean
    currency: string
}

const BudgetProgressBar: React.FC<BudgetProgressBarProps> = ({
    spent,
    remaining,
    budgetAmount,
    percentUsed,
    isOverBudget,
    currency,
}) => {
    const fillPercent = Math.min(100, percentUsed)

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
                <span className={isOverBudget ? 'text-rose-400 font-medium' : 'text-slate-400'}>
                    {formatCurrency(spent, currency)} spent
                </span>
                <span className="text-slate-500">
                    {isOverBudget ? (
                        <span className="text-rose-400 font-medium">
                            Over by {formatCurrency(Math.abs(remaining), currency)}
                        </span>
                    ) : (
                        <>{formatCurrency(remaining, currency)} left</>
                    )}
                </span>
            </div>
            <div
                className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden"
                role="progressbar"
                aria-valuenow={percentUsed}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Budget ${percentUsed}% used`}
            >
                <div
                    className={`h-full rounded-full transition-all duration-300 ${
                        isOverBudget
                            ? 'bg-gradient-to-r from-rose-500 to-rose-400'
                            : percentUsed >= 80
                              ? 'bg-gradient-to-r from-amber-500 to-amber-400'
                              : 'bg-gradient-to-r from-cyan-500 to-cyan-400'
                    }`}
                    style={{ width: `${fillPercent}%` }}
                />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>{percentUsed.toFixed(0)}% used</span>
                <span>of {formatCurrency(budgetAmount, currency)}</span>
            </div>
            {isOverBudget && (
                <p className="text-[11px] font-medium text-rose-400/90">Over budget</p>
            )}
        </div>
    )
}

export default BudgetProgressBar
