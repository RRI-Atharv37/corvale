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
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20">
                <FiAlertCircle className="text-red-400" size={22} />
            </div>
            <p className="text-sm text-slate-300">{message}</p>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm text-slate-200 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors"
                >
                    <FiRefreshCw size={14} />
                    Try again
                </button>
            )}
        </div>
    )
}

export default ErrorState
