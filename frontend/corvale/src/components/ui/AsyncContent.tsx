import React, { ReactNode } from 'react'
import LoadingState from '../ui/LoadingState'
import ErrorState from '../ui/ErrorState'
import EmptyState from '../ui/EmptyState'

interface AsyncContentProps<T> {
    loading: boolean
    error: string | null
    data: T | null
    isEmpty: (data: T) => boolean
    loadingMessage?: string
    errorMessage?: string
    emptyTitle: string
    emptyDescription?: string
    emptyAction?: ReactNode
    onRetry?: () => void
    children: (data: T) => ReactNode
}

const AsyncContent = <T,>({
    loading,
    error,
    data,
    isEmpty,
    loadingMessage,
    errorMessage,
    emptyTitle,
    emptyDescription,
    emptyAction,
    onRetry,
    children,
}: AsyncContentProps<T>): ReactNode => {
    if (loading) {
        return <LoadingState message={loadingMessage} />
    }

    if (error) {
        return <ErrorState message={errorMessage ?? error} onRetry={onRetry} />
    }

    if (!data || isEmpty(data)) {
        return (
            <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
        )
    }

    return children(data)
}

export default AsyncContent
