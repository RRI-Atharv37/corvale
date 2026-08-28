import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAsyncData } from '../useAsyncData'
import { tableInvalidationBus } from '../../db/invalidation/tableInvalidationBus'
import { setPreferredCurrency, resetPreferredCurrency, setDateFormat, resetDateFormat } from '../../utils/format'

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
