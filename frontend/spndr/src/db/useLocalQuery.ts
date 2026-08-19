import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalDb } from './LocalDb'
import { getLocalDb } from './localDbInstance'
import { tableInvalidationBus } from './invalidation/tableInvalidationBus'

interface LocalQueryState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

interface UseLocalQueryResult<T> extends LocalQueryState<T> {
  refetch: () => Promise<void>
}

/**
 * `useAsyncData`'s local-store counterpart: same `{data, loading, error,
 * refetch}` shape, but the fetcher reads from the local SQLite `LocalDb`
 * instead of hitting the API, and refetches are driven by
 * `tableInvalidationBus` rather than a `window` CustomEvent.
 */
export const useLocalQuery = <T>(table: string, fetcher: (db: LocalDb) => Promise<T>): UseLocalQueryResult<T> => {
  const [state, setState] = useState<LocalQueryState<T>>({ data: null, loading: true, error: null })

  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const refetch = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const db = await getLocalDb()
      const data = await fetcherRef.current(db)
      setState({ data, loading: false, error: null })
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load local data',
      })
    }
  }, [])

  useEffect(() => {
    void refetch()
  }, [table, refetch])

  useEffect(() => {
    return tableInvalidationBus.subscribe(table, () => {
      void refetch()
    })
  }, [table, refetch])

  return { ...state, refetch }
}
