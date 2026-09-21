import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/** Loads on mount and whenever `deps` change; a stale response never overwrites a newer one. */
export const useAsync = <T,>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> => {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const [tick, setTick] = useState(0)
  const latest = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    const request = ++latest.current
    setState((previous) => ({ ...previous, loading: true, error: null }))

    loadRef.current().then(
      (data) => {
        if (request === latest.current) setState({ data, error: null, loading: false })
      },
      (error: unknown) => {
        if (request === latest.current) setState({ data: null, error: error instanceof Error ? error.message : 'Something went wrong', loading: false })
      }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((value) => value + 1), [])

  return { ...state, reload }
}
