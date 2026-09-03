import React from 'react'
import { formatCurrency } from '@lib/format'

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
                <span className={isOverBudget ? 'text-expense font-medium' : 'text-fg-muted'}>
                    {formatCurrency(spent, currency)} spent
                </span>
                <span className="text-fg-muted">
                    {isOverBudget ? (
                        <span className="text-expense font-medium">
                            Over by {formatCurrency(Math.abs(remaining), currency)}
                        </span>
                    ) : (
                        <>{formatCurrency(remaining, currency)} left</>
                    )}
                </span>
            </div>
            <div
                className="h-2.5 w-full rounded-full bg-surface-hover overflow-hidden"
                role="progressbar"
                aria-valuenow={percentUsed}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Budget ${percentUsed}% used`}
            >
                <div
                    className={`h-full rounded-full transition-all duration-300 ${
                        isOverBudget
                            ? 'bg-negative'
                            : percentUsed >= 80
                              ? 'bg-warning'
                              : 'bg-accent'
                    }`}
                    style={{ width: `${fillPercent}%` }}
                />
            </div>
            <div className="flex items-center justify-between text-[11px] text-fg-muted">
                <span>{percentUsed.toFixed(0)}% used</span>
                <span>of {formatCurrency(budgetAmount, currency)}</span>
            </div>
            {isOverBudget && (
                <p className="text-[11px] font-medium text-expense/90">Over budget</p>
            )}
        </div>
    )
}

export default BudgetProgressBar
