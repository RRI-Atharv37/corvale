import React from 'react'
import { FiAlertCircle, FiRefreshCw } from 'react-icons/fi'

interface ErrorStateProps {
    message?: string
    onRetry?: () => void
}

const ErrorState: React.FC<ErrorStateProps> = ({
    message = 'Something went wrong while loading data.',
    onRetry,
}) => {
    return (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center max-w-md mx-auto">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-expense/10 border border-negative/20">
                <FiAlertCircle className="text-expense" size={22} />
            </div>
            <p className="text-sm text-fg-secondary">{message}</p>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-hover/50 px-4 py-2 text-sm text-fg hover:border-accent/40 hover:text-accent transition-colors"
                >
                    <FiRefreshCw size={14} />
                    Try again
                </button>
            )}
        </div>
    )
}

export default ErrorState
