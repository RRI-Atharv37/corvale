import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAsyncData } from '../useAsyncData'
import { tableInvalidationBus } from '@lib/tableInvalidationBus'
import { setPreferredCurrency, resetPreferredCurrency, setDateFormat, resetDateFormat } from '@lib/format'

describe('useAsyncData stale-response guard (BUG-78)', () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('keeps the newer scope\'s data when the older request resolves last', async () => {
    const slowPersonal = deferred<string>()
    const fastWorkspace = deferred<string>()

    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) =>
        useAsyncData(() => (scope === 'personal' ? slowPersonal.promise : fastWorkspace.promise), [scope]),
      { initialProps: { scope: 'personal' } }
    )

    rerender({ scope: 'workspace' })
    fastWorkspace.resolve('workspace rows')
    await waitFor(() => expect(result.current.data).toBe('workspace rows'))

    slowPersonal.resolve('personal rows')
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(result.current.data).toBe('workspace rows')
    expect(result.current.loading).toBe(false)
  })

  it('ignores a superseded request that fails after the newer one succeeded', async () => {
    const slowPersonal = deferred<string>()
    const fastWorkspace = deferred<string>()

    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) =>
        useAsyncData(() => (scope === 'personal' ? slowPersonal.promise : fastWorkspace.promise), [scope]),
      { initialProps: { scope: 'personal' } }
    )

    rerender({ scope: 'workspace' })
    fastWorkspace.resolve('workspace rows')
    await waitFor(() => expect(result.current.data).toBe('workspace rows'))

    slowPersonal.reject(new Error('late failure'))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(result.current.data).toBe('workspace rows')
    expect(result.current.error).toBeNull()
  })

  it('does not set state after unmount', async () => {
    const pending = deferred<string>()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { unmount } = renderHook(() => useAsyncData(() => pending.promise))
    unmount()
    pending.resolve('late')
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('useAsyncData preference-change refetch (Sprint 13.9)', () => {
  it('refetches when a preference changes via tableInvalidationBus, with no window CustomEvent involved', async () => {
    resetPreferredCurrency()
    let callCount = 0
    const fetcher = vi.fn(async () => {
      callCount += 1
      return { callCount }
    })

    const { result } = renderHook(() => useAsyncData(fetcher))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ callCount: 1 })

    setPreferredCurrency('EUR')
    await waitFor(() => expect(result.current.data).toEqual({ callCount: 2 }))

    resetPreferredCurrency()
  })

  it('setDateFormat also publishes the shared _prefs invalidation key', async () => {
    resetDateFormat()
    const listener = vi.fn()
    const unsubscribe = tableInvalidationBus.subscribe('_prefs', listener)

    setDateFormat('dd/mm/yy')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    resetDateFormat()
  })
})
