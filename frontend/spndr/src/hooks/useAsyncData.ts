import { useCallback, useEffect, useState } from 'react'
import { getApiErrorMessage } from '../utils/apiError'
import {
    PREFERRED_CURRENCY_CHANGED_EVENT,
    DATE_FORMAT_CHANGED_EVENT,
    EXCHANGE_RATES_CHANGED_EVENT,
} from '../utils/format'

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
        const handlePreferencesChange = () => {
            void refetch()
        }

        window.addEventListener(PREFERRED_CURRENCY_CHANGED_EVENT, handlePreferencesChange)
        window.addEventListener(DATE_FORMAT_CHANGED_EVENT, handlePreferencesChange)
        window.addEventListener(EXCHANGE_RATES_CHANGED_EVENT, handlePreferencesChange)
        return () => {
            window.removeEventListener(PREFERRED_CURRENCY_CHANGED_EVENT, handlePreferencesChange)
            window.removeEventListener(DATE_FORMAT_CHANGED_EVENT, handlePreferencesChange)
            window.removeEventListener(EXCHANGE_RATES_CHANGED_EVENT, handlePreferencesChange)
        }
    }, [refetch])

    return { ...state, refetch }
}
