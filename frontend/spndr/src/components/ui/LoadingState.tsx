import React from 'react'

interface LoadingStateProps {
    message?: string
}

const LoadingState: React.FC<LoadingStateProps> = ({ message = 'Loading...' }) => {
    return (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="h-10 w-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
            <p className="text-sm text-slate-400">{message}</p>
        </div>
    )
}

export default LoadingState
