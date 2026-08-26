import { useCallback, useEffect, useState } from 'react'
import { getApiErrorMessage } from '../utils/apiError'
import { PREFS_CHANGED_TABLE } from '../utils/format'
import { tableInvalidationBus } from '../db/invalidation/tableInvalidationBus'

interface AsyncState<T> {
    data: T | null
    loading: boolean
    error: string | null
}

interface UseAsyncDataResult<T> extends AsyncState<T> {
    refetch: () => Promise<void>
}

export const useAsyncData = <T>(
    fetcher: () => Promise<T>,
    deps: unknown[] = []
): UseAsyncDataResult<T> => {
    const [state, setState] = useState<AsyncState<T>>({
        data: null,
        loading: true,
        error: null,
    })

    const refetch = useCallback(async () => {
        setState((prev) => ({ ...prev, loading: true, error: null }))

        try {
            const data = await fetcher()
            setState({ data, loading: false, error: null })
        } catch (error) {
            setState({
                data: null,
                loading: false,
                error: getApiErrorMessage(error, 'Failed to load data'),
            })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps)

    useEffect(() => {
        void refetch()
    }, [refetch])

    useEffect(() => {
        return tableInvalidationBus.subscribe(PREFS_CHANGED_TABLE, () => {
            void refetch()
        })
    }, [refetch])

    return { ...state, refetch }
}
